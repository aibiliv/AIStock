"""导出当前策略配置（strategy_config.yaml 摊平结果）为 JSON。

供前端 GET /api/strategy-scan/config 调用，让网页「策略扫描」面板以 YAML 为默认初始化，
实现「网页与 CLI 共用同一份持久配置」。
"""
from __future__ import annotations

import json
import os
import sys

# dev/ 脚本需要引用 trading_agent 根目录的 config
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import config

if __name__ == "__main__":
    print(json.dumps(config.load_strategy_config(), ensure_ascii=False))
