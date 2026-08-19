<div align="center">

# GSTO

---

### GSTO: Physics-Informed Gated State Transition Operator for Interpretable Seismic Response Prediction and Uncertainty Quantification of RC Columns

<a href="https://twakjira.github.io/GSTO/" target="_blank" rel="noopener noreferrer"><img alt="Project page" src="https://img.shields.io/badge/PROJECT-PAGE-blue?style=for-the-badge"></a>
<a href="#" target="_blank" rel="noopener noreferrer"><img alt="Paper" src="https://img.shields.io/badge/PAPER-UNDER%20REVIEW-red?style=for-the-badge"></a>

<a href="https://ai4riselab.com" target="_blank" rel="noopener noreferrer">Tadesse G. Wakjira</a>

*Under Review*

</div>

---

## Overview

GSTO is an interpretable model for the cyclic response of reinforced concrete (RC)
columns. A causally masked history encoder maps the displacement and force samples
observed before a transition to a supervised engineering state of sixteen named
variables, each carrying an observability mask, and a gated residual route carries
whatever that state cannot. The state, the member properties, and the commanded half
cycle are then combined to predict the force trajectory, the state evolution, the
response variance, and the probability of a declared loss of strength condition.

On an independent external database of 1272 transitions from 37 specimens and 17
testing programs, GSTO reaches a force NRMSE of 0.657 ± 0.032 against 1.324 ±
0.303 for the strongest baseline, reduces peak force error by 61.6% and envelope
NRMSE by 75.0%, reproduces the complete response from the design variables and
the protocol alone with a force NRMSE of 0.691, and gives conformal intervals
with an empirical coverage of 0.977 at a nominal level of 0.90.

An interactive predictor and a static description of the work are available at
the <a href="https://twakjira.github.io/GSTO/" target="_blank" rel="noopener noreferrer">project page</a>.

## Status

The manuscript is currently under review. Full source code, training scripts,
processed data format, and program partitions will be released upon paper
acceptance.

## Architectural contributions

| | Element |
|---|---|
| M1 | Causally masked history encoder, so no future sample enters the prediction |
| M2 | Supervised engineering state of sixteen named variables with an explicit observability mask |
| M3 | Gated residual route, initialized open and free to close, so the reliance on the raw record is quantified instead of assumed |
| M4 | Protocol encoder for the commanded next half cycle, which is causal by construction |
| M5 | Four heads from one shared context, with the first predicted force tied to the last observed force |
| M6 | Cross-program conformal calibration and a fragility relation from the same model that predicts the response |

## Data

| Source | Use |
|---|---|
| <a href="https://peer.berkeley.edu/spd" target="_blank" rel="noopener noreferrer">PEER and UW Structural Performance Database</a> | Training and model development |
| <a href="https://doi.org/10.17603/ds2-x1z4-nq68" target="_blank" rel="noopener noreferrer">DesignSafe PRJ-6069</a> | Independent external testing, after cross-source deduplication |

## Citation

```
@article{wakjira2026gsto,
    title   = {GSTO: Physics-Informed Gated State Transition Operator for
               Interpretable Seismic Response Prediction and Uncertainty
               Quantification of RC Columns},
    author  = {Wakjira, Tadesse G.},
    journal = {Under Review},
    year    = {2026}
}
```

## Author

<strong><a href="https://ai4riselab.com" target="_blank" rel="noopener noreferrer">Tadesse G. Wakjira</a></strong>, AI4RISE Lab, Department of Civil and Environmental Engineering, Kennesaw State University

## Development

Developed by <a href="https://ai4riselab.com" target="_blank" rel="noopener noreferrer">AI4RISE Lab</a>
