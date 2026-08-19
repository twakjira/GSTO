(function (global) {
  "use strict";

  const ACCENT = "#4A90D9";
  const GREEN = "#2aa876";
  const BAND = "rgba(74,144,217,0.15)";
  const FONT = { family: "Noto Sans, Helvetica, Arial, sans-serif", size: 14, color: "#333" };

  const LAYOUT = {
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    font: FONT,
    margin: { l: 62, r: 18, t: 24, b: 56 },
    autosize: true,
    showlegend: true,
    legend: { orientation: "h", x: 0, y: 1.12, font: { size: 13 } },
    hovermode: "closest"
  };

  const AXIS = {
    showgrid: true,
    gridcolor: "#eef2f7",
    zeroline: true,
    zerolinecolor: "#cbd5e1",
    linecolor: "#cbd5e1",
    mirror: true,
    showline: true,
    ticks: "outside",
    tickcolor: "#cbd5e1"
  };

  const CONFIG = { displayModeBar: false, responsive: true };

  function ribbon(drift, lower, upper, length) {
    const x = [];
    const y = [];
    for (let start = 0; start < drift.length; start += length) {
      const end = Math.min(start + length, drift.length);
      for (let index = start; index < end; index += 1) {
        x.push(drift[index]);
        y.push(upper[index]);
      }
      for (let index = end - 1; index >= start; index -= 1) {
        x.push(drift[index]);
        y.push(lower[index]);
      }
      x.push(drift[start]);
      y.push(upper[start]);
      x.push(null);
      y.push(null);
    }
    return { x: x, y: y };
  }

  function hysteresis(result, showBand) {
    const drift = result.drift.map(function (value) { return value * 100; });
    const path = ribbon(drift, result.lower, result.upper, result.segmentLength);
    const band = {
      x: path.x,
      y: path.y,
      fill: "toself",
      fillcolor: BAND,
      line: { width: 0 },
      hoverinfo: "skip",
      name: "90% prediction band",
      type: "scatter"
    };
    const curve = {
      x: drift,
      y: result.force,
      mode: "lines",
      line: { color: ACCENT, width: 1.8 },
      name: "Predicted response",
      hovertemplate: "drift %{x:.2f}%<br>force %{y:.1f} kN<extra></extra>",
      type: "scatter"
    };
    const driftBound = Math.max.apply(null, drift.map(Math.abs)) * 1.06;
    const spread = showBand ? path.y.filter(function (value) { return value !== null; }) : result.force;
    const forceBound = Math.max.apply(null, spread.map(Math.abs)) * 1.06;
    const xRange = [-driftBound, driftBound];
    const yRange = [-forceBound, forceBound];
    const layout = Object.assign({}, LAYOUT, {
      height: 460,
      xaxis: Object.assign({}, AXIS, { title: { text: "Drift ratio (%)" }, range: xRange, automargin: true }),
      yaxis: Object.assign({}, AXIS, { title: { text: "Force (kN)" }, range: yRange, automargin: true })
    });
    Plotly.react("hysteresis-plot", showBand ? [band, curve] : [curve], layout, CONFIG);
  }

  function fragilityPoints(result) {
    const points = [];
    let survival = 1;
    let index = 0;
    while (index < result.peaks.length) {
      const peak = result.peaks[index];
      const bucket = [];
      while (index < result.peaks.length && result.peaks[index] === peak) {
        survival *= 1 - result.probability[index];
        bucket.push(result.probability[index]);
        index += 1;
      }
      const mean = bucket.reduce(function (a, b) { return a + b; }, 0) / bucket.length;
      points.push({
        x: Math.round(peak * 100000) / 1000,
        y: mean,
        cumulative: 1 - survival
      });
    }
    return points;
  }

  function fragility(points) {
    const drift = points.map(function (point) { return point.x; });
    const perAmplitude = {
      x: drift,
      y: points.map(function (point) { return point.y; }),
      mode: "lines+markers",
      line: { color: ACCENT, width: 1.8, dash: "dot" },
      marker: { color: ACCENT, size: 6 },
      name: "Per amplitude",
      hovertemplate: "peak drift %{x:.2f}%<br>probability %{y:.3f}<extra></extra>",
      type: "scatter"
    };
    const cumulative = {
      x: drift,
      y: points.map(function (point) { return point.cumulative; }),
      mode: "lines+markers",
      line: { color: GREEN, width: 2.2 },
      marker: { color: GREEN, size: 7 },
      name: "Cumulative",
      hovertemplate: "peak drift %{x:.2f}%<br>cumulative probability %{y:.3f}<extra></extra>",
      type: "scatter"
    };
    const layout = Object.assign({}, LAYOUT, {
      height: 460,
      xaxis: Object.assign({}, AXIS, {
        title: { text: "Peak imposed drift ratio (%)" },
        automargin: true,
        range: [0, Math.max.apply(null, drift) * 1.08]
      }),
      yaxis: Object.assign({}, AXIS, {
        title: { text: "Probability of strength loss" },
        range: [0, 1.02],
        automargin: true
      }),
      shapes: [{
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        y0: 0.5,
        y1: 0.5,
        line: { color: "#cbd5e1", width: 1.2, dash: "dash" }
      }]
    });
    Plotly.react("fragility-plot", [perAmplitude, cumulative], layout, CONFIG);
  }

  function crossing(points) {
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if ((a.cumulative - 0.5) * (b.cumulative - 0.5) <= 0 && b.cumulative !== a.cumulative) {
        return a.x + ((0.5 - a.cumulative) * (b.x - a.x)) / (b.cumulative - a.cumulative);
      }
    }
    return null;
  }


  const external = { cases: null, index: 0, cursor: 0, timer: null };

  function externalLayout(item) {
    const driftBound = Math.max.apply(null, item.drift.map(Math.abs)) * 1.06;
    const forceBound = Math.max(
      Math.max.apply(null, item.measured.map(Math.abs)),
      Math.max.apply(null, item.predicted.map(Math.abs))
    ) * 1.08;
    return Object.assign({}, LAYOUT, {
      height: 540,
      xaxis: Object.assign({}, AXIS, {
        title: { text: "Drift ratio (%)" },
        range: [-driftBound, driftBound],
        automargin: true
      }),
      yaxis: Object.assign({}, AXIS, {
        title: { text: "Force (kN)" },
        range: [-forceBound, forceBound],
        automargin: true
      })
    });
  }

  function externalFrame() {
    const item = external.cases[external.index];
    const total = item.drift.length;
    const stride = Math.max(6, Math.round(total / 220));
    external.cursor = Math.min(external.cursor + stride, total);
    const cut = external.cursor;
    Plotly.restyle("external-plot", {
      x: [item.drift.slice(0, cut), item.drift.slice(0, cut)],
      y: [item.measured.slice(0, cut), item.predicted.slice(0, cut)]
    }, [0, 1]);
    if (cut >= total) {
      external.timer = setTimeout(function () {
        external.cursor = 0;
        external.timer = setTimeout(externalFrame, 60);
      }, 1400);
      return;
    }
    external.timer = setTimeout(externalFrame, 32);
  }

  function playExternal(index) {
    if (!external.cases || !external.cases.length) return;
    if (external.timer) clearTimeout(external.timer);
    external.index = Math.max(0, Math.min(index, external.cases.length - 1));
    external.cursor = 0;
    const item = external.cases[external.index];
    const measured = {
      x: [], y: [],
      mode: "lines",
      line: { color: "#334155", width: 1.5, dash: "dash" },
      name: "Measured",
      hovertemplate: "drift %{x:.2f}%<br>force %{y:.1f} kN<extra></extra>",
      type: "scatter"
    };
    const predicted = {
      x: [], y: [],
      mode: "lines",
      line: { color: ACCENT, width: 1.8 },
      name: "Reconstructed",
      hovertemplate: "drift %{x:.2f}%<br>force %{y:.1f} kN<extra></extra>",
      type: "scatter"
    };
    Plotly.react("external-plot", [measured, predicted], externalLayout(item), CONFIG);
    const note = document.getElementById("external-note");
    if (note) {
      note.textContent = item.program + " · " + item.half_cycles +
        " half cycles · force NRMSE " + item.force_nrmse.toFixed(3) +
        " one half cycle ahead, " + item.free_running_nrmse.toFixed(3) + " free running";
    }
    external.timer = setTimeout(externalFrame, 120);
  }

  async function initExternal() {
    const response = await fetch("model/external.json");
    if (!response.ok) throw new Error("external.json not found");
    const payload = await response.json();
    external.cases = payload.cases;
    const select = document.getElementById("external-case");
    select.innerHTML = "";
    external.cases.forEach(function (item, index) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = item.specimen.split("_").pop();
      select.appendChild(option);
    });
    select.addEventListener("change", function () { playExternal(Number(select.value)); });
    const replay = document.getElementById("btn-replay");
    if (replay) replay.addEventListener("click", function () { playExternal(external.index); });
    playExternal(0);
  }

  function resize() {
    ["hysteresis-plot", "fragility-plot", "external-plot"].forEach(function (id) {
      const node = document.getElementById(id);
      if (node && node.data) Plotly.Plots.resize(node);
    });
  }

  function draw(result, showBand) {
    hysteresis(result, showBand);
    const points = fragilityPoints(result);
    fragility(points);
    if (window.requestAnimationFrame) window.requestAnimationFrame(resize);
    return points;
  }

  global.GSTOVIZ = { draw: draw, crossing: crossing, resize: resize, initExternal: initExternal };
})(window);
