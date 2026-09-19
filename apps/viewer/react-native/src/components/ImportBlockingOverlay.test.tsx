import React from 'react';
import { Modal, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ImportBlockingOverlay } from './ImportBlockingOverlay';

function renderOverlay(visible: boolean, archiveName?: string | null) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ImportBlockingOverlay visible={visible} archiveName={archiveName} />,
    );
  });
  return tree;
}

test('renders nothing when not mutating', () => {
  const tree = renderOverlay(false);

  expect(tree.toJSON()).toBeNull();
});

test('blocks back navigation and names the archive while mutating', () => {
  const tree = renderOverlay(true, 'noteharbor-archive.zip');
  const modal = tree.root.findByType(Modal);

  expect(modal.props.visible).toBe(true);
  expect(modal.props.onRequestClose).toEqual(expect.any(Function));
  expect(modal.props.onRequestClose()).toBeUndefined();

  const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
  expect(texts).toContain('Importing archive...');
  expect(texts).toContain('noteharbor-archive.zip');
});
