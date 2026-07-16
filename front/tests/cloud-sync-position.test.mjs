import assert from 'node:assert/strict'
import test from 'node:test'

import { hasCloudSyncPositionChanged } from '../src/services/cloudSyncPosition.ts'

function meta(parentId, siblingIds) {
  return { parentId, siblingIds }
}

function index(records) {
  return new Map(Object.entries(records).map(([id, parentId]) => [id, { parentId }]))
}

test('does not mark existing entries as moved when a sibling is added first', () => {
  const sourceMeta = meta('', ['new', 'alpha', 'beta'])
  const baseMeta = meta('', ['alpha', 'beta'])
  const sourceIndex = index({ new: '', alpha: '', beta: '' })
  const baseIndex = index({ alpha: '', beta: '' })

  assert.equal(hasCloudSyncPositionChanged('alpha', sourceMeta, baseMeta, sourceIndex, baseIndex), false)
  assert.equal(hasCloudSyncPositionChanged('beta', sourceMeta, baseMeta, sourceIndex, baseIndex), false)
})

test('does not mark existing entries as moved when an earlier sibling is deleted', () => {
  const sourceMeta = meta('', ['alpha', 'beta'])
  const baseMeta = meta('', ['removed', 'alpha', 'beta'])
  const sourceIndex = index({ alpha: '', beta: '' })
  const baseIndex = index({ removed: '', alpha: '', beta: '' })

  assert.equal(hasCloudSyncPositionChanged('alpha', sourceMeta, baseMeta, sourceIndex, baseIndex), false)
  assert.equal(hasCloudSyncPositionChanged('beta', sourceMeta, baseMeta, sourceIndex, baseIndex), false)
})

test('marks entries whose relative sibling order changed', () => {
  const sourceMeta = meta('', ['beta', 'alpha', 'gamma'])
  const baseMeta = meta('', ['alpha', 'beta', 'gamma'])
  const sourceIndex = index({ alpha: '', beta: '', gamma: '' })
  const baseIndex = index({ alpha: '', beta: '', gamma: '' })

  assert.equal(hasCloudSyncPositionChanged('alpha', sourceMeta, baseMeta, sourceIndex, baseIndex), true)
  assert.equal(hasCloudSyncPositionChanged('beta', sourceMeta, baseMeta, sourceIndex, baseIndex), true)
  assert.equal(hasCloudSyncPositionChanged('gamma', sourceMeta, baseMeta, sourceIndex, baseIndex), false)
})

test('marks a cross-group move without shifting entries left behind', () => {
  const sourceIndex = index({ moved: 'folder', alpha: '', beta: '' })
  const baseIndex = index({ moved: '', alpha: '', beta: '' })

  assert.equal(
    hasCloudSyncPositionChanged('moved', meta('folder', ['moved']), meta('', ['moved', 'alpha', 'beta']), sourceIndex, baseIndex),
    true
  )
  assert.equal(
    hasCloudSyncPositionChanged('alpha', meta('', ['alpha', 'beta']), meta('', ['moved', 'alpha', 'beta']), sourceIndex, baseIndex),
    false
  )
  assert.equal(
    hasCloudSyncPositionChanged('beta', meta('', ['alpha', 'beta']), meta('', ['moved', 'alpha', 'beta']), sourceIndex, baseIndex),
    false
  )
})
