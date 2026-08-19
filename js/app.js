(function () {
  "use strict";

  const FIELDS = [
    { key: "shear_span_mm", label: "<i>L</i><sub>s</sub>", plain: "Ls", unit: "mm", step: 1 },
    { key: "depth_mm", label: "<i>h</i>", plain: "h", unit: "mm", step: 1 },
    { key: "width_mm", label: "<i>b</i>", plain: "b", unit: "mm", step: 1 },
    { key: "aspect_ratio", label: "<i>L</i><sub>s</sub>/<i>h</i>", plain: "Ls/h", unit: "", step: 0.01, derived: true },
    { key: "concrete_strength_mpa", label: "<i>f</i>&#x2032;<sub>c</sub>", plain: "f′c", unit: "MPa", step: 0.1 },
    { key: "longitudinal_yield_mpa", label: "<i>f</i><sub>y</sub>", plain: "fy", unit: "MPa", step: 1 },
    { key: "transverse_yield_mpa", label: "<i>f</i><sub>yt</sub>", plain: "fyt", unit: "MPa", step: 1 },
    { key: "longitudinal_ratio", label: "&rho;<sub>l</sub>", plain: "ρl", unit: "", step: 0.001 },
    { key: "transverse_volumetric_ratio", label: "&rho;<sub>s</sub>", plain: "ρs", unit: "", step: 0.001 },
    { key: "axial_load_ratio", label: "<i>P</i>/(<i>A</i><sub>g</sub><i>f</i>&#x2032;<sub>c</sub>)", plain: "ALR", unit: "", step: 0.01 },
    { key: "cover_mm", label: "<i>c</i>", plain: "c", unit: "mm", step: 0.5 },
    { key: "bar_diameter_mm", label: "<i>d</i><sub>b</sub>", plain: "db", unit: "mm", step: 0.5 },
    { key: "hoop_spacing_mm", label: "<i>s</i>", plain: "s", unit: "mm", step: 1 }
  ];

  const DEFAULT_AMPLITUDES = "0.5, 1, 1.5, 2, 3, 4, 5, 6";
  const DEFAULT_CYCLES = "2";

  let lastResult = null;

  function $(id) { return document.getElementById(id); }
  function fmt(value, digits) { return Number(value).toFixed(digits == null ? 1 : digits); }

  function buildForm() {
    const meta = window.GSTO.meta;
    const form = $("predictor-form");
    form.innerHTML = "";
    FIELDS.forEach(function (field) {
      const range = meta.ranges[field.key] || [null, null];
      const value = meta.defaults_map[field.key];
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.dataset.key = field.key;
      const unit = field.unit ? ' <span class="field-unit">(' + field.unit + ')</span>' : "";
      const hint = field.derived
        ? "Derived from " + "L" + "s" + " and h"
        : "Range: " + range[0] + " – " + range[1] + (field.unit ? " " + field.unit : "");
      wrap.innerHTML =
        '<label class="field-label" for="f-' + field.key + '">' + field.label + unit + "</label>" +
        '<input class="field-input" id="f-' + field.key + '" type="number" step="' + field.step + '"' +
        (field.derived ? " readonly" : "") + ' value="' + value + '" />' +
        '<span class="range-hint">' + hint + "</span>";
      form.appendChild(wrap);
      const input = wrap.querySelector("input");
      if (!field.derived) input.addEventListener("input", onFieldInput);
    });
    updateAspect();
  }

  function updateAspect() {
    const span = parseFloat($("f-shear_span_mm").value);
    const depth = parseFloat($("f-depth_mm").value);
    const node = $("f-aspect_ratio");
    if (node && isFinite(span) && isFinite(depth) && depth > 0) {
      node.value = (span / depth).toFixed(3);
    }
  }

  function onFieldInput() {
    updateAspect();
    flagExtrapolation();
  }

  function readDesign() {
    return FIELDS.map(function (field) { return parseFloat($("f-" + field.key).value); });
  }

  function readAmplitudes() {
    return $("f-amplitudes").value
      .split(/[,\s]+/)
      .map(function (token) { return parseFloat(token); })
      .filter(function (value) { return isFinite(value) && value > 0; })
      .map(function (value) { return value / 100; });
  }

  function readCycles() {
    const value = parseInt($("f-cycles").value, 10);
    return Math.max(1, Math.min(5, isFinite(value) ? value : 2));
  }

  function classify(value, range) {
    if (!isFinite(value) || !range) return null;
    const margin = (range[1] - range[0]) * 0.1;
    if (value >= range[0] && value <= range[1]) return "in-range";
    if (value >= range[0] - margin && value <= range[1] + margin) return "near-boundary";
    return "out-of-range";
  }

  function flagExtrapolation() {
    const meta = window.GSTO.meta;
    if (!meta || !meta.ranges) return false;
    const offenders = [];
    FIELDS.forEach(function (field) {
      const wrap = document.querySelector('.field[data-key="' + field.key + '"]');
      if (!wrap) return;
      wrap.classList.remove("in-range", "near-boundary", "out-of-range");
      const value = parseFloat($("f-" + field.key).value);
      const range = meta.ranges[field.key];
      const verdict = classify(value, range);
      if (verdict) wrap.classList.add(verdict);
      if (verdict === "out-of-range") {
        offenders.push(field.plain + " = " + fmt(value, 3) +
          " (valid: " + range[0] + " to " + range[1] + ")");
      }
    });

    const amplitudes = readAmplitudes();
    const box = $("warning-box");
    const block = offenders.length > 0 || amplitudes.length === 0;
    if (block) {
      box.classList.remove("hidden");
      box.classList.add("block");
      box.textContent = amplitudes.length === 0
        ? "At least one positive drift amplitude is required."
        : offenders.length + " input(s) outside the range covered by the training specimens. " +
          "Prediction is disabled to avoid unreliable extrapolation. Offending: " +
          offenders.join("; ") + ".";
    } else {
      box.classList.add("hidden");
      box.classList.remove("block");
      box.textContent = "";
    }
    const button = $("btn-predict");
    if (button) button.disabled = block;
    return block;
  }

  function resetInputs() {
    const meta = window.GSTO.meta;
    FIELDS.forEach(function (field) {
      $("f-" + field.key).value = meta.defaults_map[field.key];
    });
    $("f-amplitudes").value = DEFAULT_AMPLITUDES;
    $("f-cycles").value = DEFAULT_CYCLES;
    updateAspect();
    flagExtrapolation();
    onPredict();
  }

  async function onPredict() {
    if (flagExtrapolation()) return;
    const button = $("btn-predict");
    button.disabled = true;
    button.textContent = "Predicting…";
    try {
      const started = performance.now();
      const result = await window.GSTO.rollout(readDesign(), readAmplitudes(), readCycles());
      lastResult = result;
      $("results").classList.remove("hidden");
      $("plot-block").classList.remove("hidden");
      const points = window.GSTOVIZ.draw(result, $("show-band").checked);
      $("r-peak").textContent = fmt(Math.max.apply(null, result.force.map(Math.abs)), 1);
      const crossing = window.GSTOVIZ.crossing(points);
      $("r-drift").textContent = crossing === null ? "beyond the protocol" : fmt(crossing, 2);
      $("r-energy").textContent = fmt(Math.abs(result.energy) / 1000, 1);
      const half = result.upper.map(function (value, index) {
        return 0.5 * (value - result.lower[index]);
      });
      $("r-band").textContent = fmt(half.reduce(function (a, b) { return a + b; }, 0) / half.length, 1);
      $("r-steps").textContent = String(result.halfCycles);
      const status = $("predictor-status");
      status.classList.remove("error");
      status.classList.add("ready");
      status.classList.remove("hidden");
      status.textContent = "Response generated in " + Math.round(performance.now() - started) + " ms.";
    } catch (error) {
      const status = $("predictor-status");
      status.classList.remove("hidden", "ready");
      status.classList.add("error");
      status.textContent = "Prediction failed: " + error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Predict";
    }
  }

  async function init() {
    const status = $("predictor-status");
    try {
      const meta = await window.GSTO.load();
      buildForm();
      flagExtrapolation();
      status.classList.add("ready");
      status.textContent = "Operator ready. Trained on " + meta.training_transitions +
        " transitions from " + meta.training_specimens + " specimens.";
      $("btn-predict").disabled = false;
    } catch (error) {
      status.textContent = "Failed to load the operator: " + error.message;
      status.classList.add("error");
      return;
    }
    $("btn-predict").addEventListener("click", onPredict);
    $("btn-reset").addEventListener("click", resetInputs);
    $("f-amplitudes").addEventListener("input", flagExtrapolation);
    window.addEventListener("resize", function () { window.GSTOVIZ.resize(); });
    $("show-band").addEventListener("change", function () {
      if (lastResult) window.GSTOVIZ.draw(lastResult, $("show-band").checked);
    });
    await onPredict();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
