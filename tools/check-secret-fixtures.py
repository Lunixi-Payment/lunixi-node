#!/usr/bin/env python3
"""Check narrow reviewed fixture exceptions and planted secret-shaped controls.

Never prints findings/values. Raw reports exist only inside a private temporary
directory containing copies of the reviewed, hash-pinned synthetic tests.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = {
    "test/fixtures/webhook-v2-vectors.json": "565c81e8397355ed5c64e36064d345a5617c233841be149ba7336b55b478c94d",
    "test/insurance-client.test.js": "a09a65d068451248643a95bad369cebae204af94a041839a03ee4327b75f101e",
    "test/fixtures/physical-pos-parity.json": "02a9b4e156ff152f92355ce939b6ab5f44c8e8c7195fbdb96fe7cd3be79aee76",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def scan(source: Path, config: Path, report: Path) -> list[dict]:
    result = subprocess.run(
        ["gitleaks", "dir", str(source), "--no-banner", "--log-level", "error",
         "--config", str(config), "--report-format", "json", "--report-path", str(report)],
        capture_output=True, check=False,
    )
    require(result.returncode in {0, 1}, "Gitleaks execution/configuration failed; raw diagnostics withheld.")
    findings = json.loads(report.read_text()) if report.exists() else []
    require((result.returncode == 0) == (not findings), "Unexpected scanner/report outcome.")
    return findings


def main() -> None:
    require(shutil.which("gitleaks") is not None, "Install Gitleaks 8.21+ before this verification.")
    config = ROOT / ".gitleaks.toml"
    parsed = tomllib.loads(config.read_text())
    require(parsed.get("extend") == {"useDefault": True}, "All default rules must remain enabled.")
    require("allowlist" not in parsed and "allowlists" not in parsed, "No global exception is permitted.")
    rules = parsed.get("rules", [])
    require(len(rules) == 1 and rules[0].get("id") == "generic-api-key", "Only reviewed generic fixture exceptions are allowed.")
    allowlists = rules[0].get("allowlists", [])
    require(len(allowlists) == 3 and all(item.get("condition") == "AND" and item.get("regexTarget") == "secret" for item in allowlists),
            "Exceptions must require both exact value and reviewed path.")
    for relative, expected in FIXTURES.items():
        require(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == expected,
                "Reviewed fixture changed; investigate and review its provenance again.")

    with tempfile.TemporaryDirectory(prefix="lunixi-secret-fixture-check-") as directory:
        temporary = Path(directory)
        source = temporary / "source"
        source.mkdir()
        default = temporary / "defaults.toml"
        default.write_text("[extend]\nuseDefault = true\n")
        for relative in FIXTURES:
            target = source / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        baseline = scan(source, default, temporary / "baseline.json")
        require(len(baseline) == 5 and all(item["RuleID"] == "generic-api-key" for item in baseline),
                "Expected exactly the five reviewed synthetic baseline findings.")
        require(not scan(source, config, temporary / "configured.json"), "Reviewed fixture exceptions failed.")

        # Fresh values in EACH allowed file must remain detectable. Invalid JSON
        # here is intentional: the scanner checks raw text, not JSON validity.
        controls = 0
        for index, relative in enumerate(FIXTURES):
            target = source / relative
            original = target.read_bytes()
            target.write_bytes(original + ('\napi_key = "' + secrets.token_urlsafe(36) + '"\n').encode())
            findings = scan(source, config, temporary / f"fresh-{index}.json")
            require(any(item["RuleID"] == "generic-api-key" and Path(item["File"]) == target for item in findings),
                    "A fresh credential-shaped control was incorrectly ignored in an allowed fixture path.")
            target.write_bytes(original)
            controls += 1

        # The EXACT reviewed value outside its path must still be detected.
        other = source / "src" / "control.js"
        other.parent.mkdir()
        for index, relative in enumerate(FIXTURES):
            reviewed = next(item["Secret"] for item in baseline if Path(item["File"]) == source / relative)
            other.write_text('api_key = "' + reviewed + '"\n')
            require(any(item["RuleID"] == "generic-api-key" and Path(item["File"]) == other
                        for item in scan(source, config, temporary / f"wrong-path-{index}.json")),
                    "A reviewed value outside its allowed path was incorrectly ignored.")
            controls += 1

        # An unrelated default rule must still operate (synthetic, never an
        # actual GitHub account credential; no external authentication occurs).
        other.write_text('github_token = "ghp_' + secrets.token_hex(18) + '"\n')
        require(any(item["RuleID"] == "github-pat" for item in scan(source, config, temporary / "default-rule.json")),
                "An unrelated default secret rule was disabled.")
        controls += 1

    print(json.dumps({"baselineFindings": 5, "reviewedFixtureFindings": 0,
                      "negativeControlsCaught": controls, "allDefaultRulesExtended": True}))


if __name__ == "__main__":
    main()
