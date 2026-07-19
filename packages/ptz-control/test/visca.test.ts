import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  panTiltCommand,
  presetRecallCommand,
  presetStoreCommand,
  viscaOverIp,
  zoomCommand,
} from '../src/visca.js'

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

test('pan/tilt drive encodes direction and clamps speed', () => {
  assert.equal(hex(panTiltCommand('left', 'up', 0x0c, 0x0c)), '81 01 06 01 0c 0c 01 01 ff')
  assert.equal(hex(panTiltCommand('right', 'down', 0x0c, 0x0c)), '81 01 06 01 0c 0c 02 02 ff')
  assert.equal(hex(panTiltCommand('stop', 'stop')), '81 01 06 01 0c 0c 03 03 ff')
  // pan speed clamps to 0x18 max, tilt to 0x14 max
  assert.equal(hex(panTiltCommand('left', 'up', 0xff, 0xff)), '81 01 06 01 18 14 01 01 ff')
})

test('zoom encodes tele/wide/stop with speed nibble', () => {
  assert.equal(hex(zoomCommand('stop')), '81 01 04 07 00 ff')
  assert.equal(hex(zoomCommand('in', 0x04)), '81 01 04 07 24 ff')
  assert.equal(hex(zoomCommand('out', 0x04)), '81 01 04 07 34 ff')
  assert.equal(hex(zoomCommand('in', 0xff)), '81 01 04 07 27 ff') // speed clamps to 7
})

test('preset recall and store', () => {
  assert.equal(hex(presetRecallCommand(3)), '81 01 04 3f 02 03 ff')
  assert.equal(hex(presetStoreCommand(5)), '81 01 04 3f 01 05 ff')
})

test('VISCA-over-IP header carries type, length and sequence', () => {
  const payload = zoomCommand('stop') // 6 bytes
  const packet = viscaOverIp(payload, 0x01020304)
  assert.equal(hex(packet.slice(0, 8)), '01 00 00 06 01 02 03 04')
  assert.equal(hex(packet.slice(8)), hex(payload))
})
