# Azure compute (moved)

Azure VM/ACI automation now lives in the unified **azure** package under `compute` config and `--section compute`.

See [azure.md](azure.md).

```bash
node apps/hdc-cli/cli.mjs run infrastructure azure query -- --section compute --live
node apps/hdc-cli/cli.mjs run infrastructure azure deploy -- --section compute --instance a --dry-run
```
