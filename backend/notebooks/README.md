# Notebooks

The starting point for both backend packages. Each one runs top to bottom against the live
database and writes nothing until you set `DRY_RUN = False`.

```bash
pip install -e backend            # pandas, JupyterLab, and both packages on sys.path
python -m jupyterlab backend/notebooks
```

| | |
|---|---|
| `portfolio_data.ipynb` | pull client models and holdings, fill in a DataFrame of analytics, upload it |
| `crm_sync.ipynb` | create client interactions, one at a time or in a batch |

`SQLITE_DIR` needs no setting up in a checkout — it is read from the environment or from the
same `.env` the Next.js app uses. If a notebook's first cell raises `ConfigError`, start the
app once (`npm run dev`) or run `npm run seed` so the `.sqlite` files exist.

Commit these with their outputs cleared. They are documentation, and a diff of re-rendered
cell output buries the change to the code.
