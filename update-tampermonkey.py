import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8787
SCRIPT_NAME = "acfun动态.user.js"
SCRIPT_URL = f"http://{HOST}:{PORT}/{urllib.request.quote(SCRIPT_NAME)}"
ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / SCRIPT_NAME
SERVER = ROOT / "tampermonkey-update-server.py"


def bump_patch_version(text):
    match = re.search(r"^// @version\s+(\d+)\.(\d+)\.(\d+)\s*$", text, re.MULTILINE)
    if not match:
        raise RuntimeError("未找到 UserScript @version")
    major, minor, patch = map(int, match.groups())
    new_version = f"{major}.{minor}.{patch + 1}"
    text = re.sub(
        r"^// @version\s+\d+\.\d+\.\d+\s*$",
        f"// @version      {new_version}",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    return text, new_version


def ensure_server():
    try:
        with urllib.request.urlopen(SCRIPT_URL, timeout=1.5) as response:
            if response.status == 200:
                return
    except Exception:
        pass

    subprocess.Popen(
        [sys.executable, str(SERVER)],
        cwd=str(ROOT),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    for _ in range(20):
        try:
            with urllib.request.urlopen(SCRIPT_URL, timeout=1.5) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"更新服务未启动成功：{SCRIPT_URL}")


def open_in_chrome():
    candidates = [
        Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe",
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    ]
    chrome = next((path for path in candidates if path.exists()), None)
    if chrome:
        subprocess.Popen([str(chrome), SCRIPT_URL])
    else:
        subprocess.Popen(["cmd", "/c", "start", "", SCRIPT_URL], shell=False)


def main():
    text = SCRIPT.read_text(encoding="utf-8")
    if "--no-bump" in sys.argv:
        new_version = re.search(r"^// @version\s+(.+?)\s*$", text, re.MULTILINE).group(1)
    else:
        text, new_version = bump_patch_version(text)
        SCRIPT.write_text(text, encoding="utf-8", newline="\n")

    ensure_server()
    if "--no-open" not in sys.argv:
        open_in_chrome()
    print(f"{SCRIPT_NAME} v{new_version}")
    print(SCRIPT_URL)


if __name__ == "__main__":
    main()
