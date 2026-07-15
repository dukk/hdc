# AWS (HDC automation)

HDC manages AWS infrastructure via [`clumps/infrastructure/aws/`](../../clumps/infrastructure/aws/). Config lives in hdc-private `clumps/infrastructure/aws/config.json`.

## Credentials

| Variable | Where | Purpose |
| --- | --- | --- |
| `HDC_AWS_ACCESS_KEY_ID` | `.env` | IAM access key id |
| `HDC_AWS_SECRET_ACCESS_KEY` | vault | IAM secret |
| `HDC_AWS_SESSION_TOKEN` | vault (optional) | STS session for assumed roles |

Create a dedicated IAM user or role for HDC. Do not commit keys to git.

## Cost confirmation

Before creating billable resources, `deploy` and `maintain` estimate monthly USD cost using the public **AWS Price List API** and require confirmation unless:

- `--yes` is passed (automation / hdc-runner)
- `--dry-run` (estimate only)
- `--skip-cost-confirm` (logged in report)
- `cost.confirm_before_deploy` is `false` in config

Estimates exclude data transfer, tax, Savings Plans, Reserved Instances, free tier, and NAT data-processing charges. NAT Gateway and public IPv4 surcharges are called out as warnings when applicable.

## IAM minimum policy (illustrative)

Scope permissions to HDC-tagged resources where possible. All created resources receive `hdc:managed=true` and `hdc:resource-id=<config-id>` tags.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "ecs:*",
        "s3:*",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:PassRole"
      ],
      "Resource": "*"
    }
  ]
}
```

Tighten `Resource` ARNs and add `Condition` on `aws:RequestTag/hdc:managed` for production accounts.

## Bootstrap

1. Copy `config.example.json` to hdc-private and set `aws.region`, resource ids, and AMIs for your account.
2. Set vault secret and `.env` access key id.
3. `hdc run infrastructure aws query -- --dry-run`
4. `hdc run infrastructure aws deploy -- --dry-run` — review cost estimate in stderr and report.
5. `hdc run infrastructure aws deploy --` — confirm at prompt.
6. `hdc run infrastructure aws query --` — verify diffs.

## Inventory

Optional target sidecar: `inventory/manual/targets/aws.json` with `kind: "target"` and `automation_target: "aws"`.

## Service deploy backends

Service packages may use `aws-ec2` or `aws-ecs` deploy modes (see `scanopy` pilot) which reuse the same cost gate helpers under `clumps/lib/deploy-cost-confirm.mjs`.
