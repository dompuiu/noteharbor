import { isArchivePickerAvailable, pickArchiveFile } from './archivePicker';

describe('archive picker', () => {
  it('is available on windows via the native picker', () => {
    expect(isArchivePickerAvailable('windows')).toBe(true);
    expect(isArchivePickerAvailable('ios')).toBe(true);
    expect(isArchivePickerAvailable('macos')).toBe(true);
  });

  it('delegates to the Windows native picker', async () => {
    const windowsPick = jest
      .fn()
      .mockResolvedValue({ archivePath: 'C:\\tmp\\a.zip', name: 'a.zip' });
    const pick = jest.fn();
    await expect(
      pickArchiveFile({
        platform: 'windows',
        pick,
        windowsPick,
        isCancel: () => false,
      }),
    ).resolves.toEqual({ archivePath: 'C:\\tmp\\a.zip', name: 'a.zip' });
    expect(windowsPick).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
  });

  it('returns null when the Windows picker is cancelled', async () => {
    const windowsPick = jest.fn().mockResolvedValue(null);
    await expect(
      pickArchiveFile({
        platform: 'windows',
        pick: jest.fn(),
        windowsPick,
        isCancel: () => false,
      }),
    ).resolves.toBeNull();
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
