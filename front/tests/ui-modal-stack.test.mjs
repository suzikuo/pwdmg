import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  MODAL_STACK_MAX_OFFSET,
  clearModalStack,
  getModalStackOffset,
  isTopModalInStack,
  pushModalToStack,
  removeModalFromStack
} from '../src/services/modalStack.ts'

test('later opened modals always receive a higher z-index offset than earlier modals', () => {
  clearModalStack()
  pushModalToStack('settings-modal')
  pushModalToStack('password-modal')
  pushModalToStack('nested-modal')

  assert.equal(getModalStackOffset('settings-modal'), 0)
  assert.equal(getModalStackOffset('password-modal'), 1)
  assert.equal(getModalStackOffset('nested-modal'), 2)
  assert.equal(isTopModalInStack('settings-modal'), false)
  assert.equal(isTopModalInStack('password-modal'), false)
  assert.equal(isTopModalInStack('nested-modal'), true)

  removeModalFromStack('nested-modal')
  assert.equal(isTopModalInStack('password-modal'), true)
  assert.equal(getModalStackOffset('password-modal'), 1)

  // Re-opening an earlier modal brings it to the top
  pushModalToStack('settings-modal')
  assert.equal(isTopModalInStack('settings-modal'), true)
  assert.equal(getModalStackOffset('password-modal'), 0)
  assert.equal(getModalStackOffset('settings-modal'), 1)

  clearModalStack()
})

test('stacked prop keeps at least offset 1 and stack offset is bounded below toast layer', () => {
  clearModalStack()
  pushModalToStack('only-modal')
  assert.equal(getModalStackOffset('only-modal', false), 0)
  assert.equal(getModalStackOffset('only-modal', true), 1)

  for (let i = 0; i < MODAL_STACK_MAX_OFFSET + 20; i += 1) {
    pushModalToStack(`modal-${i}`)
  }
  assert.equal(getModalStackOffset(`modal-${MODAL_STACK_MAX_OFFSET + 19}`), MODAL_STACK_MAX_OFFSET)
  clearModalStack()
})

test('UiModal binds reactive stack z-index and restricts Escape to the topmost modal', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const modalSrc = fs.readFileSync(path.join(root, 'src/components/ui/UiModal.vue'), 'utf8')

  assert.match(modalSrc, /:style="backdropStyle"/)
  assert.match(modalSrc, /pushModalToStack\(modalStackId\)/)
  assert.match(modalSrc, /removeModalFromStack\(modalStackId\)/)
  assert.match(modalSrc, /!isTopModalInStack\(modalStackId\)/)
})
