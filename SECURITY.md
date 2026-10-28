# Security Policy

## Supported versions

Before 1.0, security fixes go into the **latest 0.x release** only. From 1.0, the current major and the previous one (for 12 months after the next major) get security fixes — see [docs/versioning.md](docs/versioning.md).

This covers the framework (`express-file-cluster`), the scaffolder (`create-efc-app`) and the code they generate (`efc add` items).

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub: the repository's **Security** tab → **Report a vulnerability**.

Include what you can: the version, the affected route or function, steps or a request that reproduces it, and the impact you see. You'll get an acknowledgement within a few days. Once a fix is released, the changelog credits the reporter (unless you'd rather not be named).

## Fixes in generated code

Generated files belong to your app, so upgrading the package doesn't patch them. Security releases that touch generated code say exactly which files are affected and how to update them (`efc add <item> --overwrite`, or the change to make by hand).
