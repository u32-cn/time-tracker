'use strict'

/* 本地开发启动器：清掉可能存在的 ELECTRON_RUN_AS_NODE，避免 Electron 退化成纯 Node */
const { spawn } = require('node:child_process')
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.'], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code == null ? 0 : code))
