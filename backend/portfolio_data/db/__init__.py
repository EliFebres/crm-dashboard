"""
Everything that opens a file.

`connection.py` is the only place this package couples to crm_sync, reusing the pragma set
and the BEGIN IMMEDIATE / retry machinery rather than keeping a second copy that could
drift. `reader.py` pulls models from engagements.sqlite (the source of truth);
`schema.py` / `writer.py` / `verify.py` own the sidecar tables in portfolio.sqlite.

Importable, but not the supported surface — see the package docstring.
"""
