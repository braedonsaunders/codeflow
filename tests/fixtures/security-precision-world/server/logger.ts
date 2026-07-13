import { exec } from "node:child_process";

export function bootServer() {
  console.log('booting server');
  console.log('loading config');
  console.info('config loaded');
  console.debug('ready to accept connections');
}

export function restartWorker(cmd: string) {
  exec(cmd);
}

export function spawnJob(cmd: string) {
  const { exec: runCmd } = require("node:child_process");
  runCmd(cmd);
}
