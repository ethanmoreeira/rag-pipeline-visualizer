import test from 'node:test'
import assert from 'node:assert/strict'
import { replayFrame } from './replayFrame.ts'

test('timestamp anterior ao início nunca produz índice negativo que derrube a cena',()=>{
  assert.equal(replayFrame(99.8,100,9,3400),0)
  assert.equal(replayFrame(3500,100,9,3400),1)
  assert.equal(replayFrame(999999,100,9,3400),8)
  assert.equal(replayFrame(120,100,0,3400),0)
})
