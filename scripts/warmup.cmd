@echo off
rem DSH-Search-Contrl 定时预热：每 2 小时跑一次当日采集，让 RSS 缓存保持热状态，
rem 这样日报不用每次冷抓（冷跑 10 秒 -> 热跑 0.1 秒）。
rem
rem 用法（Windows 任务计划程序）：
rem   1. 新建任务，触发器：每天，每隔 2 小时重复；
rem   2. 操作：启动程序，指向本文件（scripts\warmup.cmd）；
rem   3. 勾上“不管用户是否登录都要运行”，起始位置留空即可。
rem macOS / Linux 用 cron 代替本文件：
rem   0 */2 * * * cd <你的 DSH profile>/node_modules/dsh-search-contrl && node scripts/daily-collect.mjs --days=1 --archive >> scripts/.cache/warmup.log 2>&1
rem
rem 本次运行只做两件事：抓一次当日源（写进 scripts\.cache\feeds，TTL 2 小时）、
rem 落一份当日归档快照（reports\_data\archive）。不发报告、不改设置。
cd /d "%~dp0.."
if not exist scripts\.cache mkdir scripts\.cache
node scripts\daily-collect.mjs --days=1 --archive >> scripts\.cache\warmup.log 2>&1
