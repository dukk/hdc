# Azure compute (moved)

Azure VM/ACI automation now lives in the unified **azure** package under `compute` config and `--section compute`.

See [azure.md](azure.md).

```bash
hdc run infrastructure azure query -- --section compute --live
hdc run infrastructure azure deploy -- --section compute --instance a --dry-run
```
