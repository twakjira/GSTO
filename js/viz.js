(function (global) {
  "use strict";

  const ACCENT = "#4A90D9";
  const GREEN = "#2aa876";
  const BAND = "rgba(74,144,217,0.18)";
  const FONT = { family: "Noto Sans, Helvetica, Arial, sans-serif", size: 14, color: "#333" };

  const LAYOUT = {
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    font: FONT,
    margin: { l: 70, r: 24, t: 24, b: 60 },
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

  function hysteresis(result) {
    const drift = result.drift.map(function (value) { return value * 100; });
    const band = {
      x: drift.concat(drift.slice().reverse()),
      y: result.upper.concat(result.lower.slice().reverse()),
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
    const layout = Object.assign({}, LAYOUT, {
      height: 520,
      xaxis: Object.assign({}, AXIS, { title: { text: "Drift ratio (%)" } }),
      yaxis: Object.assign({}, AXIS, { title: { text: "Force (kN)" } })
    });
    Plotly.react("hysteresis-plot", [band, curve], layout, CONFIG);
  }

  function fragilityPoints(result) {
    const grouped = new Map();
    result.peaks.forEach(function (peak, index) {
      const key = Math.round(peak * 100000) / 1000;
      const bucket = grouped.get(key) || [];
      bucket.push(result.probability[index]);
      grouped.set(key, bucket);
    });
    return Array.from(grouped.keys()).sort(function (a, b) { return a - b; }).map(function (key) {
      const bucket = grouped.get(key);
      const mean = bucket.reduce(function (a, b) { return a + b; }, 0) / bucket.length;
      return { x: key, y: mean };
    });
  }

  function fragility(points) {
    const trace = {
      x: points.map(function (point) { return point.x; }),
      y: points.map(function (point) { return point.y; }),
      mode: "lines+markers",
      line: { color: GREEN, width: 2 },
      marker: { color: GREEN, size: 7 },
      name: "Probability of strength loss",
      hovertemplate: "peak drift %{x:.2f}%<br>probability %{y:.3f}<extra></extra>",
      type: "scatter"
    };
    const layout = Object.assign({}, LAYOUT, {
      height: 380,
      showlegend: false,
      xaxis: Object.assign({}, AXIS, { title: { text: "Peak imposed drift ratio (%)" } }),
      yaxis: Object.assign({}, AXIS, { title: { text: "Probability of strength loss" }, range: [0, 1] }),
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
    Plotly.react("fragility-plot", [trace], layout, CONFIG);
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

  function draw(result) {
    hysteresis(result);
    const points = fragilityPoints(result);
    fragility(points);
    return points;
  }

  global.GSTOVIZ = { draw: draw, crossing: crossing };
})(window);
