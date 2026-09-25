import React from 'react';
import { Image, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { NoteImageView } from './NoteImageView';

test('shows a themed placeholder when there is no image uri', () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteImageView uri={null} width={96} height={56} />,
    );
  });

  expect(tree.root.findByType(Text).props.children).toBe('No image');
});

test('renders the bundled fallback asset when there is no uri', () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteImageView uri={null} fallbackSource={42} width={96} height={56} />,
    );
  });

  expect(tree.root.findByType(Image).props.source).toBe(42);
});

test('renders the fallback asset on error when one is given', () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteImageView uri="file:///tmp/a.jpg" fallbackSource={42} width={96} height={56} />,
    );
  });

  const image = tree.root.findByType(Image);
  act(() => {
    image.props.onError();
  });

  expect(tree.root.findByType(Image).props.source).toBe(42);
});

test('renders the image and falls back to the placeholder on error', () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteImageView uri="file:///tmp/a.jpg" width={96} height={56} />,
    );
  });

  const image = tree.root.findByType(Image);
  expect(image.props.source).toEqual({ uri: 'file:///tmp/a.jpg' });

  act(() => {
    image.props.onError();
  });

  expect(tree.root.findByType(Text).props.children).toBe('No image');
});

test('supports cover fit with a custom radius', () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteImageView
        uri="file:///tmp/a.jpg"
        width={96}
        height={56}
        fit="cover"
        radius={10}
      />,
    );
  });

  const image = tree.root.findByType(Image);
  expect(image.props.resizeMode).toBe('cover');
  expect(image.props.style).toEqual(
    expect.objectContaining({ width: 96, height: 56, borderRadius: 10 }),
  );
});

test('renders a placeholder icon instead of text when provided', () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteImageView
        uri={null}
        width={96}
        height={56}
        radius={10}
        placeholderIcon={<View testID="custom-icon" />}
      />,
    );
  });

  expect(
    tree.root.findAll((node) => node.props?.testID === 'custom-icon').length,
  ).toBeGreaterThan(0);
  expect(tree.root.findAllByType(Text).length).toBe(0);
});
