"""
Contracts and settings. No SQL, no file handles, no I/O.

`models.py` is the boundary: what `get_models` hands out and what `upload_pf_data` takes
in. `sleeves.py` is the one piece of real logic here — splitting a model into its equity
and fixed income portfolios and rescaling each to stand alone. `config.py` is the file a
user edits; `periods.py` explains why every model-level date has to be a quarter end.

Importable, but not the supported surface — see the package docstring.
"""
