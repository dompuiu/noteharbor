import { isArchivePickerAvailable, pickArchiveFile } from './archivePicker';

describe('archive picker', () => {
  it('is unavailable on windows where there is no native picker', () => {
    expect(isArchivePickerAvailable('windows')).toBe(false);
    expect(isArchivePickerAvailable('ios')).toBe(true);
    expect(isArchivePickerAvailable('macos')).toBe(true);
  });

  it('returns null on windows without invoking the picker', async () => {
    const pick = jest.fn();
    await expect(
      pickArchiveFile({ platform: 'windows', pick, isCancel: () => false }),
    ).resolves.toBeNull();
    expect(pick).not.toHaveBeenCalled();
  });

  it('normalizes the picked uri to a local path', async () => {
    const pick = jest.fn().mockResolvedValue([
      { uri: 'file:///var/mobile/Containers/my%20archive.zip', name: 'my archive.zip' },
    ]);

    await expect(
      pickArchiveFile({ platform: 'ios', zipType: 'application/zip', pick, isCancel: () => false }),
    ).resolves.toEqual({
      archivePath: '/var/mobile/Containers/my archive.zip',
      name: 'my archive.zip',
    });
    expect(pick).toHaveBeenCalledWith({ type: ['application/zip'] });
  });

  it('returns null when the user cancels', async () => {
    const pick = jest.fn().mockRejectedValue(new Error('cancelled'));

    await expect(
      pickArchiveFile({ platform: 'ios', zipType: 'application/zip', pick, isCancel: () => true }),
    ).resolves.toBeNull();
  });

  it('rethrows unexpected picker errors', async () => {
    const pick = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      pickArchiveFile({ platform: 'ios', zipType: 'application/zip', pick, isCancel: () => false }),
    ).rejects.toThrow('boom');
  });
});
