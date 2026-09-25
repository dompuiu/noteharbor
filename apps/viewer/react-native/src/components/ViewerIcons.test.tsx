import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import {
  CloseIcon,
  ImageIcon,
  SearchIcon,
  UploadIcon,
} from './ViewerIcons';

test.each([
  ['search', <SearchIcon key="s" size={18} color="#000" />, 'icon-search'],
  ['close', <CloseIcon key="c" size={18} color="#000" />, 'icon-close'],
  ['upload', <UploadIcon key="u" size={20} color="#000" />, 'icon-upload'],
  ['image', <ImageIcon key="i" size={22} color="#000" />, 'icon-image'],
])('renders the %s icon', (_name, element, testID) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element);
  });

  expect(
    tree.root.findAll((node) => node.props?.testID === testID).length,
  ).toBeGreaterThan(0);
});
