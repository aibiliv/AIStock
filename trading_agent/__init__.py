"""交易 Agent MVP

实现文档 trading-agent-architecture.md 的核心闭环：选票 → 操作 → 回测 → 优化策略。
数据底座用真实 A 股公开接口（腾讯财经 + 东财 push2his），无需 key、无需连接连接器。
"""
