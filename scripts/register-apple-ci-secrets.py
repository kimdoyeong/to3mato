#!/usr/bin/env python3
"""Register Apple notarization credentials without displaying or saving them."""

import getpass
import shutil
import subprocess
import sys

REPOSITORY = "kimdoyeong/to3mato"
TEAM_ID = "H2RM6XYB9D"


def run_private(arguments, value=None, timeout=60):
    return subprocess.run(
        arguments,
        input=value,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def main():
    if not sys.stdin.isatty():
        print("직접 입력할 수 있는 터미널에서 실행하세요.")
        return 1
    if not all(shutil.which(tool) for tool in ("gh", "xcrun")):
        print("GitHub CLI와 Xcode 명령줄 도구가 필요합니다.")
        return 1
    if run_private(["gh", "auth", "status"]).returncode:
        print("먼저 GitHub CLI에 로그인하세요.")
        return 1

    print(f"등록 대상: {REPOSITORY} / Actions Secrets")
    print("입력값은 화면에 표시하거나 파일에 저장하지 않습니다.")
    apple_id = getpass.getpass("Apple 계정: ").strip()
    password = getpass.getpass("Apple 앱 전용 암호: ").strip()
    if not apple_id or not password:
        print("빈 값은 등록하지 않았습니다.")
        return 1

    print("Apple 공증 서비스 인증 확인 중...")
    result = run_private([
        "xcrun", "notarytool", "history",
        "--apple-id", apple_id,
        "--password", password,
        "--team-id", TEAM_ID,
        "--output-format", "json",
    ])
    if result.returncode:
        print("Apple 인증에 실패했습니다. 계정과 앱 전용 암호를 확인하세요.")
        return 1

    for name, value in (
        ("APPLE_ID", apple_id),
        ("APPLE_APP_SPECIFIC_PASSWORD", password),
    ):
        result = run_private(
            ["gh", "secret", "set", name, "--repo", REPOSITORY], value
        )
        if result.returncode:
            print(f"{name} 등록에 실패했습니다. 다시 실행하세요.")
            return 1
        print(f"등록 완료: {name}")
    print("Apple 공증 인증 확인과 GitHub Secrets 등록을 완료했습니다.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print("\n입력을 취소했습니다.")
        sys.exit(1)
    except (OSError, subprocess.TimeoutExpired):
        print("실행 또는 연결에 실패했습니다. 환경을 확인하고 다시 실행하세요.")
        sys.exit(1)
