(function (global) {
  "use strict";

  const MODEL_DIR = "model/";

  let session = null;
  let meta = null;

  async function load() {
    if (typeof ort === "undefined") {
      throw new Error("onnxruntime-web is not loaded");
    }
    if (ort && ort.env && ort.env.wasm) {
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
      ort.env.wasm.numThreads = 1;
    }
    const response = await fetch(MODEL_DIR + "meta.json");
    if (!response.ok) throw new Error("meta.json not found");
    meta = await response.json();
    global.GSTO.meta = meta;
    session = await ort.InferenceSession.create(
      MODEL_DIR + "gsto.onnx",
      { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
    );
    return meta;
  }

  function standardize(key, values) {
    const stats = meta.stats[key];
    return Float32Array.from(values, function (value, index) {
      return (value - stats.mean[index]) / stats.std[index];
    });
  }

  function destandardize(key, values) {
    const stats = meta.stats[key];
    return Array.from(values, function (value, index) {
      return value * stats.std[index] + stats.mean[index];
    });
  }

  function maskOf(stateVector) {
    const mask = new Float32Array(stateVector.length);
    const scalars = meta.scalar_state_count;
    for (let index = 0; index < scalars; index += 1) mask[index] = 1;
    const positive = stateVector[3];
    const negative = Math.abs(stateVector[4]);
    const grid = meta.drift_grid;
    grid.forEach(function (level, index) {
      if (level <= positive) mask[scalars + index] = 1;
      if (level <= negative) mask[scalars + grid.length + index] = 1;
    });
    return mask;
  }

  function ramp(from, to, length) {
    const out = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      out[index] = from + ((to - from) * index) / (length - 1);
    }
    return out;
  }

  function protocolSegments(amplitudes, cycles) {
    const segments = [];
    let previous = 0;
    amplitudes.forEach(function (amplitude) {
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        [amplitude, -amplitude].forEach(function (target) {
          segments.push({
            drift: ramp(previous, target, meta.segment_length),
            direction: target > previous ? 1 : -1,
            peak: amplitude
          });
          previous = target;
        });
      }
    });
    return segments;
  }

  async function rollout(design, amplitudes, cycles) {
    if (!session || !meta) throw new Error("the model is not loaded");
    const historyLength = meta.history_length;
    const forceScale = meta.stats.response.std[0];
    const stateSize = meta.stats.state.mean.length;
    const segments = protocolSegments(amplitudes, cycles);

    let historyDrift = new Float32Array(historyLength);
    let historyForce = new Float32Array(historyLength);
    let mask = new Float32Array(stateSize);

    const designTensor = new ort.Tensor(
      "float32",
      standardize("design", design),
      [1, meta.design_fields.length]
    );
    const result = {
      drift: [], force: [], lower: [], upper: [],
      peaks: [], probability: [], energy: 0, halfCycles: segments.length,
      segmentLength: meta.segment_length
    };

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const last = segment.drift.length - 1;
      const features = [
        segment.drift[0],
        segment.drift[last],
        Math.max.apply(null, Array.from(segment.drift, Math.abs)),
        segment.drift[last] - segment.drift[0],
        segment.direction,
        meta.median_segment_samples
      ];
      const output = await session.run({
        design: designTensor,
        state_mask: new ort.Tensor("float32", mask.slice(), [1, stateSize]),
        protocol: new ort.Tensor("float32", standardize("protocol", segment.drift), [1, meta.segment_length]),
        protocol_features: new ort.Tensor("float32", standardize("protocol_features", features), [1, features.length]),
        history_displacement: new ort.Tensor("float32", standardize("history_displacement", historyDrift), [1, historyLength]),
        history_force: new ort.Tensor("float32", Float32Array.from(historyForce, function (value) {
          return value / forceScale;
        }), [1, historyLength])
      });

      const force = Array.from(output.response.data, function (value) { return value * forceScale; });
      const spread = Array.from(output.log_variance.data, function (value) {
        return Math.sqrt(Math.exp(value)) * forceScale;
      });
      const shearSpan = design[meta.design_fields.indexOf("shear_span_mm")];

      for (let sample = 0; sample < force.length; sample += 1) {
        result.drift.push(segment.drift[sample]);
        result.force.push(force[sample]);
        result.lower.push(force[sample] - 1.645 * spread[sample]);
        result.upper.push(force[sample] + 1.645 * spread[sample]);
        if (sample > 0) {
          result.energy += 0.5 * (force[sample] + force[sample - 1]) *
            (segment.drift[sample] - segment.drift[sample - 1]) * shearSpan;
        }
      }
      result.peaks.push(segment.peak);
      result.probability.push(1 / (1 + Math.exp(-output.strength_loss_logit.data[0])));

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

  global.GSTO = { load: load, rollout: rollout, meta: null };
})(window);
