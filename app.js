const FIELD_LABELS = {
  shear_span_mm: ["Shear span", "mm"],
  depth_mm: ["Section depth", "mm"],
  width_mm: ["Section width", "mm"],
  aspect_ratio: ["Aspect ratio", "-"],
  concrete_strength_mpa: ["Concrete strength", "MPa"],
  longitudinal_yield_mpa: ["Longitudinal yield", "MPa"],
  transverse_yield_mpa: ["Transverse yield", "MPa"],
  longitudinal_ratio: ["Longitudinal ratio", "-"],
  transverse_volumetric_ratio: ["Transverse volumetric ratio", "-"],
  axial_load_ratio: ["Axial load ratio", "-"],
  cover_mm: ["Cover", "mm"],
  bar_diameter_mm: ["Bar diameter", "mm"],
  hoop_spacing_mm: ["Hoop spacing", "mm"]
};

const state = { meta: null, session: null, busy: false };

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function buildForm() {
  const host = document.getElementById("design");
  host.innerHTML = "";
  state.meta.design_fields.forEach((name, index) => {
    const [label, unit] = FIELD_LABELS[name] || [name, ""];
    const wrapper = document.createElement("label");
    const text = document.createTextNode(unit === "-" ? label : `${label} (${unit})`);
    const input = document.createElement("input");
    input.type = "number";
    input.id = `f_${name}`;
    input.step = "any";
    input.value = String(round(state.meta.defaults[index], 3));
    if (name === "aspect_ratio") input.readOnly = true;
    wrapper.appendChild(text);
    wrapper.appendChild(input);
    host.appendChild(wrapper);
  });
  ["shear_span_mm", "depth_mm"].forEach((name) => {
    const node = document.getElementById(`f_${name}`);
    if (node) node.addEventListener("input", updateAspect);
  });
  updateAspect();
}

function updateAspect() {
  const span = Number(document.getElementById("f_shear_span_mm").value);
  const depth = Number(document.getElementById("f_depth_mm").value);
  const node = document.getElementById("f_aspect_ratio");
  if (node && depth > 0) node.value = String(round(span / depth, 3));
}

function designVector() {
  return state.meta.design_fields.map((name) => Number(document.getElementById(`f_${name}`).value));
}

function standardize(key, values) {
  const stats = state.meta.stats[key];
  return Float32Array.from(values, (value, index) => (value - stats.mean[index]) / stats.std[index]);
}

function destandardize(key, values) {
  const stats = state.meta.stats[key];
  return Array.from(values, (value, index) => value * stats.std[index] + stats.mean[index]);
}

function maskOf(stateVector) {
  const meta = state.meta;
  const mask = new Float32Array(stateVector.length);
  const scalars = meta.scalar_state_count;
  for (let index = 0; index < scalars; index += 1) mask[index] = 1;
  const positive = stateVector[3];
  const negative = Math.abs(stateVector[4]);
  const grid = meta.drift_grid;
  grid.forEach((level, index) => {
    if (level <= positive) mask[scalars + index] = 1;
    if (level <= negative) mask[scalars + grid.length + index] = 1;
  });
  return mask;
}

function ramp(from, to, length) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = from + ((to - from) * i) / (length - 1);
  return out;
}

function buildProtocol() {
  const raw = document.getElementById("amplitudes").value;
  const cycles = Math.max(1, Math.min(5, Number(document.getElementById("cycles").value) || 2));
  const amplitudes = raw
    .split(/[,\s]+/)
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value / 100);
  const segments = [];
  let previous = 0;
  amplitudes.forEach((amplitude) => {
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      [amplitude, -amplitude].forEach((target) => {
        segments.push({
          drift: ramp(previous, target, state.meta.segment_length),
          direction: target > previous ? 1 : -1,
          peak: amplitude
        });
        previous = target;
      });
    }
  });
  return segments;
}

async function rollout() {
  const meta = state.meta;
  const historyLength = meta.history_length;
  const forceScale = meta.stats.response.std[0];
  const stateSize = meta.stats.state.mean.length;
  const segments = buildProtocol();

  let historyDrift = new Float32Array(historyLength);
  let historyForce = new Float32Array(historyLength);
  let mask = new Float32Array(stateSize);

  const design = new ort.Tensor("float32", standardize("design", designVector()), [1, meta.design_fields.length]);
  const result = { drift: [], force: [], lower: [], upper: [], peaks: [], probability: [], energy: 0 };

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const features = [
      segment.drift[0],
      segment.drift[segment.drift.length - 1],
      Math.max(...Array.from(segment.drift, Math.abs)),
      segment.drift[segment.drift.length - 1] - segment.drift[0],
      segment.direction,
      meta.median_segment_samples
    ];
    const feeds = {
      design,
      state_mask: new ort.Tensor("float32", mask.slice(), [1, stateSize]),
      protocol: new ort.Tensor("float32", standardize("protocol", segment.drift), [1, meta.segment_length]),
      protocol_features: new ort.Tensor("float32", standardize("protocol_features", features), [1, features.length]),
      history_displacement: new ort.Tensor("float32", standardize("history_displacement", historyDrift), [1, historyLength]),
      history_force: new ort.Tensor("float32", Float32Array.from(historyForce, (value) => value / forceScale), [1, historyLength])
    };
    const output = await state.session.run(feeds);
    const force = Array.from(output.response.data, (value) => value * forceScale);
    const spread = Array.from(output.log_variance.data, (value) => Math.sqrt(Math.exp(value)) * forceScale);
    const probability = 1 / (1 + Math.exp(-output.strength_loss_logit.data[0]));

    for (let i = 0; i < force.length; i += 1) {
      result.drift.push(segment.drift[i]);
      result.force.push(force[i]);
      result.lower.push(force[i] - 1.645 * spread[i]);
      result.upper.push(force[i] + 1.645 * spread[i]);
      if (i > 0) {
        const shear = document.getElementById("f_shear_span_mm").value;
        result.energy += 0.5 * (force[i] + force[i - 1]) * (segment.drift[i] - segment.drift[i - 1]) * Number(shear);
      }
    }
    result.peaks.push(segment.peak);
    result.probability.push(probability);

    mask = maskOf(destandardize("state_next", output.state_next.data));
    const nextDrift = new Float32Array(historyLength);
    const nextForce = new Float32Array(historyLength);
    const keep = historyLength - meta.segment_length;
    nextDrift.set(historyDrift.slice(meta.segment_length), 0);
    nextForce.set(historyForce.slice(meta.segment_length), 0);
    nextDrift.set(segment.drift, keep);
    nextForce.set(Float32Array.from(force), keep);
    historyDrift = nextDrift;
    historyForce = nextForce;
  }
  return result;
}

function prepare(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = (canvas.height / canvas.width) * width;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function axes(context, box, xLabel, yLabel, xTicks, yTicks, formatX, formatY) {
  context.strokeStyle = "#c9d3de";
  context.fillStyle = "#5b6b7c";
  context.lineWidth = 1;
  context.font = "13px Inter, Helvetica Neue, Arial, sans-serif";
  context.strokeRect(box.left, box.top, box.width, box.height);
  context.textAlign = "center";
  context.textBaseline = "top";
  xTicks.forEach((tick) => {
    const x = box.left + ((tick.value - box.xMin) / (box.xMax - box.xMin)) * box.width;
    context.beginPath();
    context.moveTo(x, box.top + box.height);
    context.lineTo(x, box.top + box.height + 5);
    context.stroke();
    context.fillText(formatX(tick.value), x, box.top + box.height + 8);
  });
  context.textAlign = "right";
  context.textBaseline = "middle";
  yTicks.forEach((tick) => {
    const y = box.top + box.height - ((tick.value - box.yMin) / (box.yMax - box.yMin)) * box.height;
    context.beginPath();
    context.moveTo(box.left - 5, y);
    context.lineTo(box.left, y);
    context.stroke();
    context.fillText(formatY(tick.value), box.left - 8, y);
  });
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(xLabel, box.left + box.width / 2, box.top + box.height + 42);
  context.save();
  context.translate(box.left - 52, box.top + box.height / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(yLabel, 0, 0);
  context.restore();
}

function ticksOf(minimum, maximum, count) {
  const out = [];
  for (let i = 0; i <= count; i += 1) out.push({ value: minimum + ((maximum - minimum) * i) / count });
  return out;
}

function drawHysteresis(result) {
  const canvas = document.getElementById("hysteresis");
  const { context, width, height } = prepare(canvas);
  const box = { left: 78, top: 22, width: width - 110, height: height - 78 };
  const driftPercent = result.drift.map((value) => value * 100);
  const bound = Math.max(...driftPercent.map(Math.abs)) * 1.08;
  const forceBound = Math.max(...result.upper.map(Math.abs), ...result.lower.map(Math.abs)) * 1.08;
  Object.assign(box, { xMin: -bound, xMax: bound, yMin: -forceBound, yMax: forceBound });

  const px = (value) => box.left + ((value - box.xMin) / (box.xMax - box.xMin)) * box.width;
  const py = (value) => box.top + box.height - ((value - box.yMin) / (box.yMax - box.yMin)) * box.height;

  context.fillStyle = "rgba(11, 92, 171, 0.16)";
  context.beginPath();
  driftPercent.forEach((value, index) => {
    const x = px(value);
    const y = py(result.upper[index]);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  for (let index = driftPercent.length - 1; index >= 0; index -= 1) {
    context.lineTo(px(driftPercent[index]), py(result.lower[index]));
  }
  context.closePath();
  context.fill();

  context.strokeStyle = "#0b5cab";
  context.lineWidth = 1.4;
  context.beginPath();
  driftPercent.forEach((value, index) => {
    const x = px(value);
    const y = py(result.force[index]);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  context.strokeStyle = "#aab6c4";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(px(0), box.top);
  context.lineTo(px(0), box.top + box.height);
  context.moveTo(box.left, py(0));
  context.lineTo(box.left + box.width, py(0));
  context.stroke();
  context.setLineDash([]);

  axes(
    context,
    box,
    "Drift ratio (%)",
    "Force (kN)",
    ticksOf(box.xMin, box.xMax, 6),
    ticksOf(box.yMin, box.yMax, 6),
    (value) => value.toFixed(1),
    (value) => value.toFixed(0)
  );
}

function drawFragility(result) {
  const canvas = document.getElementById("fragility");
  const { context, width, height } = prepare(canvas);
  const box = { left: 78, top: 22, width: width - 110, height: height - 78 };
  const points = [];
  const grouped = new Map();
  result.peaks.forEach((peak, index) => {
    const key = round(peak * 100, 3);
    const bucket = grouped.get(key) || [];
    bucket.push(result.probability[index]);
    grouped.set(key, bucket);
  });
  Array.from(grouped.keys())
    .sort((a, b) => a - b)
    .forEach((key) => {
      const bucket = grouped.get(key);
      points.push({ x: key, y: bucket.reduce((a, b) => a + b, 0) / bucket.length });
    });
  Object.assign(box, { xMin: 0, xMax: Math.max(...points.map((p) => p.x)) * 1.05, yMin: 0, yMax: 1 });

  const px = (value) => box.left + ((value - box.xMin) / (box.xMax - box.xMin)) * box.width;
  const py = (value) => box.top + box.height - ((value - box.yMin) / (box.yMax - box.yMin)) * box.height;

  context.strokeStyle = "#e3e9f0";
  [0.25, 0.5, 0.75].forEach((level) => {
    context.beginPath();
    context.moveTo(box.left, py(level));
    context.lineTo(box.left + box.width, py(level));
    context.stroke();
  });

  context.strokeStyle = "#c0392b";
  context.lineWidth = 1.6;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(px(point.x), py(point.y));
    else context.lineTo(px(point.x), py(point.y));
  });
  context.stroke();
  context.fillStyle = "#c0392b";
  points.forEach((point) => {
    context.beginPath();
    context.arc(px(point.x), py(point.y), 3.2, 0, Math.PI * 2);
    context.fill();
  });

  axes(
    context,
    box,
    "Peak imposed drift ratio (%)",
    "Probability of strength loss",
    ticksOf(box.xMin, box.xMax, 6),
    ticksOf(0, 1, 4),
    (value) => value.toFixed(1),
    (value) => value.toFixed(2)
  );
  return points;
}

function crossing(points) {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if ((a.y - 0.5) * (b.y - 0.5) <= 0 && b.y !== a.y) {
      return a.x + ((0.5 - a.y) * (b.x - a.x)) / (b.y - a.y);
    }
  }
  return null;
}

async function predict() {
  if (state.busy || !state.session) return;
  state.busy = true;
  const button = document.getElementById("run");
  const status = document.getElementById("status");
  button.disabled = true;
  status.textContent = "Generating the response.";
  try {
    const started = performance.now();
    const result = await rollout();
    drawHysteresis(result);
    const points = drawFragility(result);
    document.getElementById("peak").textContent = round(Math.max(...result.force.map(Math.abs)), 1).toFixed(1);
    const drift = crossing(points);
    document.getElementById("driftloss").textContent = drift === null ? "not reached" : drift.toFixed(2);
    document.getElementById("energy").textContent = round(Math.abs(result.energy) / 1000, 1).toFixed(1);
    status.textContent = `${result.peaks.length} half cycles generated in ${Math.round(performance.now() - started)} ms.`;
  } catch (error) {
    status.textContent = `Prediction failed: ${error.message}`;
  } finally {
    button.disabled = false;
    state.busy = false;
  }
}

async function boot() {
  const status = document.getElementById("status");
  try {
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
    ort.env.wasm.numThreads = 1;
    state.meta = await (await fetch("model/meta.json")).json();
    buildForm();
    state.session = await ort.InferenceSession.create("model/gsto.onnx", { executionProviders: ["wasm"] });
    status.textContent = `Operator ready. Trained on ${state.meta.training_transitions} transitions from ${state.meta.training_specimens} specimens.`;
    await predict();
  } catch (error) {
    status.textContent = `The operator could not be loaded: ${error.message}`;
  }
}

document.getElementById("run").addEventListener("click", predict);
document.getElementById("reset").addEventListener("click", () => {
  buildForm();
  document.getElementById("amplitudes").value = "0.5, 1, 1.5, 2, 3, 4, 5, 6";
  document.getElementById("cycles").value = "2";
  predict();
});

boot();
