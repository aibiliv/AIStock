"""导出当前策略配置（strategy_config.yaml 摊平结果）为 JSON。

供前端 GET /api/strategy-scan/config 调用，让网页「策略扫描」面板以 YAML 为默认初始化，
实现「网页与 CLI 共用同一份持久配置」。
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config

if __name__ == "__main__":
    print(json.dumps(config.load_strategy_config(), ensure_ascii=False))
