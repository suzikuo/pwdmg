"""Ask the locally installed Codex CLI to search the web for AWS news.

This launches an ephemeral, read-only Codex session with native web search:
    python .\test2.py

No API key is stored in this file. The Codex CLI must already be installed and
logged in. Set CODEX_BIN only when `codex` is not available on PATH.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone


TIMEOUT_SECONDS = 300


def build_prompt() -> str:
    china_standard_time = timezone(timedelta(hours=8))
    today = datetime.now(china_standard_time).date().isoformat()
    return f"""今天是 {today}（Asia/Shanghai）。
你只需要完成新闻检索，不要读取或修改本地文件，也不要运行 shell 命令。
请使用可用的原生 Web Search 查询与 AWS 云从业者相关的最新新闻，重点关注：
1. AWS Certified Cloud Practitioner、AI Practitioner 及其他 AWS 认证变化；
2. AWS 官方服务发布中对初级云工程师有直接影响的内容；
3. AWS 云技能、培训和就业趋势。

检索策略要求：
- 优先引用 aws.amazon.com 官方公告，其次使用可靠媒体；
- 优先今天发布或最近 24 小时的内容；若不足，明确标注日期并补充近期重要消息；
- 区分“今天发布”与“今天发生”，不要把旧闻说成今日新闻；
- 每条给出标题、发布日期、摘要、从业者影响和原始链接；
- 最后列出实际使用的搜索关键词，并说明信息时效与无法核实的部分；
- 使用 Markdown 链接引用来源。
请用中文回答。"""


def find_codex() -> str | None:
    configured_path = os.environ.get("CODEX_BIN")
    if configured_path:
        return configured_path
    return shutil.which("codex")


def main() -> int:
    codex_bin = find_codex()
    if not codex_bin:
        print(
            "错误：找不到 Codex CLI。请安装 Codex，或设置 CODEX_BIN。",
            file=sys.stderr,
        )
        return 2

    command = [
        codex_bin,
        "--search",
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        build_prompt(),
    ]

    print("=== 启动 Codex 原生 Web Search ===")
    print(f"Codex: {codex_bin}")
    print("模式: exec / ephemeral / read-only / search enabled")
    print("说明: Python 不直接访问私有 web.run；搜索由 Codex CLI 会话执行。\n")

    try:
        completed = subprocess.run(
            command,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        if exc.stdout:
            print(exc.stdout)
        if exc.stderr:
            print(exc.stderr, file=sys.stderr)
        print(f"Codex 搜索超过 {TIMEOUT_SECONDS} 秒，已停止等待。", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"无法启动 Codex CLI：{exc}", file=sys.stderr)
        return 1

    if completed.stderr:
        print("=== Codex 运行日志 ===", file=sys.stderr)
        print(completed.stderr.rstrip(), file=sys.stderr)

    print("=== Codex 最终输出 ===")
    print(completed.stdout.rstrip() or "Codex 没有返回标准输出。")

    if completed.returncode != 0:
        print(f"Codex CLI 退出码：{completed.returncode}", file=sys.stderr)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
