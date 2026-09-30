import assert from 'node:assert/strict'
import test from 'node:test'
import { isActivePreparation } from './preparationLifecycle.ts'

const activePhases=['reading','parsing','normalizing','metadata','splitting','chunking','loading','embedding','awaitingSave','saving','validating']
const terminalPhases=['checking','idle','ready','error']

test('cancelamento manual só é elegível durante uma preparação ativa',()=>{
  for(const phase of activePhases)assert.equal(isActivePreparation(phase,true),true,phase)
  for(const phase of terminalPhases)assert.equal(isActivePreparation(phase,true),false,phase)
})

test('limpeza de unmount não vira erro visível quando o controlador já foi liberado',()=>{
  for(const phase of activePhases)assert.equal(isActivePreparation(phase,false),false,phase)
})

test('reentrância não cria uma segunda preparação enquanto a primeira está ativa',()=>{
  assert.equal(isActivePreparation('reading',true),true)
  assert.equal(isActivePreparation('idle',false),false)
})

test('pausa antes do Qdrant continua sendo uma fase ativa e cancelável',()=>{
  assert.equal(isActivePreparation('awaitingSave',true),true)
})

console.log('PASS: cancelamento manual, cleanup silencioso e guarda contra reentrância.')
