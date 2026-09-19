import {
  datasetSourceLabel,
  describeDatasetBuiltAt,
  type ViewerCollection,
} from '../shared/viewer-core';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { viewerLight, viewerRadii } from '../theme/viewerTheme';

import { ImportBlockingOverlay } from './ImportBlockingOverlay';
import { pickArchiveFile, type ArchivePickResult } from '../native/archivePicker';
import type { ViewerControllerState } from '../state/useViewerController';
import appManifest from '../../app.json';

function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

function currentPlatform(): string {
  try {
    const reactNative = require('react-native') as {
      Platform?: { OS?: string };
    };
    return reactNative.Platform?.OS ?? 'ios';
  } catch {
    return 'ios';
  }
}
function dropdownLabel(collection: ViewerCollection): string {
  return `${collection.name}${collection.isDefault ? ' (default)' : ''} (${collection.noteCount})`;
}

export function ImportScreen({
  controller,
  isFirstRun,
  onClose,
  pickArchive = pickArchiveFile,
  platform = currentPlatform(),
  paintDelayMs = 150,
}: {
  controller: ViewerControllerState;
  isFirstRun: boolean;
  onClose?: () => void;
  pickArchive?: () => Promise<ArchivePickResult | null>;
  platform?: string;
  paintDelayMs?: number;
}) {
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const dataset = controller.dataset;
  const collections = dataset?.collections ?? [];
  const activeCollection = controller.activeCollection;
  const generatedAt = dataset?.generatedAt?.trim() ?? '';
  const isBusy = controller.isMutating || isPicking || isImporting;
  const useManualPath = platform === 'windows';

  const pick = async () => {
    setIsPicking(true);
    setMessage(null);
    try {
      const picked = await pickArchive();
      if (picked) {
        setPickedPath(picked.archivePath);
        setPickedName(picked.name ?? basenameOf(picked.archivePath));
      }
    } finally {
      setIsPicking(false);
    }
  };

  const applyManualPath = () => {
    const trimmed = manualPath.trim();
    if (!trimmed) {
      return;
    }
    setPickedPath(trimmed);
    setPickedName(basenameOf(trimmed));
    setMessage(null);
  };

  const importPicked = () => {
    if (!pickedPath) {
      setMessage('Choose an archive before importing.');
      return;
    }
    const archivePath = pickedPath;
    const archiveName = pickedName ?? basenameOf(archivePath);
    Alert.alert(
      'Import archive?',
      'Importing an archive replaces collections found in the archive (matched by name). Collections not present in the archive stay untouched on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: () => {
            void (async () => {
              setIsImporting(true);
              setMessage(null);
              // Let the dialog dismiss and the blocking overlay paint before
              // the import monopolizes the thread (Flutter 150ms delay).
              await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), paintDelayMs);
              });
              try {
                await controller.importArchive(archivePath);
                setPickedPath(null);
                setPickedName(null);
                setMessage(`Imported ${archiveName} successfully.`);
              } catch (error) {
                setMessage(`Import failed: ${error}`);
              } finally {
                setIsImporting(false);
              }
            })();
          },
        },
      ],
    );
  };

  const deleteActive = () => {
    if (!activeCollection) {
      setMessage('Select a collection to delete.');
      return;
    }
    const collection = activeCollection;
    Alert.alert(
      'Delete collection?',
      `Delete "${collection.name}" and all notes/images in that collection from this device?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await controller.deleteCollection(collection.id);
                setMessage(`Deleted ${collection.name}.`);
              } catch (error) {
                setMessage(`Delete failed: ${error}`);
              }
            })();
          },
        },
      ],
    );
  };

  const deleteAll = () => {
    Alert.alert(
      'Delete imported data?',
      'This removes the imported archive from this device. You will need to import another archive before browsing notes again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await controller.deleteImportedDataset();
                setPickedPath(null);
                setPickedName(null);
                setMessage(
                  'Imported data deleted. Import another archive to continue.',
                );
              } catch (error) {
                setMessage(`Delete failed: ${error}`);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        {!isFirstRun && !isBusy ? (
          <Pressable
            testID="import-back"
            accessibilityLabel="Back"
            onPress={onClose}
            style={styles.backButton}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle}>Import Dataset</Text>
      </View>
      <ScrollView style={styles.body}>
        {isFirstRun ? (
          <View style={styles.panel}>
            <Text testID="import-empty-title" style={styles.panelTitle}>
              Import data to get started
            </Text>
            <Text style={styles.panelBody}>
              This viewer no longer ships with a bundled dataset. Choose a Note
              Harbor archive exported from the editor to install your notes,
              pictures, and SQLite database on this device.
            </Text>
          </View>
        ) : null}
        <View style={styles.panel}>
          <Text style={styles.panelHeading}>Manage viewer data</Text>
          <Text style={styles.panelBody}>
            Import a Note Harbor archive exported from the editor. Imported
            data stays on this device. Collections present in the archive
            replace matching local collections by name; other local collections
            stay untouched.
          </Text>
          <View style={styles.pillRow}>
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>Active source</Text>
              <Text testID="pill-active-source" style={styles.pillValue}>
                {dataset ? datasetSourceLabel(dataset.source) : 'No dataset imported'}
              </Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>Dataset built</Text>
              <Text testID="pill-dataset-built" style={styles.pillValue}>
                {describeDatasetBuiltAt(generatedAt || null)}
              </Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>Collections</Text>
              <Text testID="pill-collections" style={styles.pillValue}>
                {`${collections.length}`}
              </Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>Notes (active)</Text>
              <Text testID="pill-notes-active" style={styles.pillValue}>
                {`${activeCollection?.noteCount ?? 0}`}
              </Text>
            </View>
          </View>
        </View>
        {collections.length > 0 ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Active collection</Text>
            <Text style={styles.panelBody}>
              Select which collection is shown in the table and slideshow
              screens.
            </Text>
            <View style={styles.optionList}>
              {collections.map((collection) => {
                const selected = collection.id === controller.activeCollectionId;
                return (
                  <Pressable
                    key={collection.id}
                    testID={`collection-option-${collection.id}`}
                    accessibilityLabel={`Select collection ${collection.name}`}
                    disabled={isBusy}
                    onPress={() => {
                      controller.selectCollection(collection.id);
                      setMessage(null);
                    }}
                    style={[
                      styles.option,
                      selected && styles.optionSelected,
                      isBusy && styles.optionDisabled,
                    ]}>
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextSelected,
                      ]}>
                      {dropdownLabel(collection)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              testID="set-as-default"
              accessibilityLabel="Set as default collection"
              disabled={
                isBusy || activeCollection == null || activeCollection.isDefault
              }
              onPress={() => {
                if (activeCollection != null) {
                  void controller.setDefaultCollection(activeCollection.id);
                }
              }}
              style={[
                styles.tonalButton,
                (isBusy ||
                  activeCollection == null ||
                  activeCollection.isDefault) &&
                  styles.buttonDisabled,
              ]}>
              <Text style={styles.tonalButtonText}>
                Set as default collection
              </Text>
            </Pressable>
            <Pressable
              testID="delete-active-collection"
              accessibilityLabel="Delete active collection"
              disabled={isBusy || activeCollection == null}
              onPress={deleteActive}
              style={[
                styles.dangerTonalButton,
                (isBusy || activeCollection == null) &&
                  styles.buttonDisabled,
              ]}>
              <Text style={styles.dangerTonalButtonText}>
                Delete active collection
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Archive import</Text>
          <Text style={styles.panelBody}>
            Choose a `.zip` archive with `banknotes.db` and `images/`, then
            import it into the native viewer app.
          </Text>
          <View style={styles.archiveBox}>
            <Text testID="picked-archive-name" style={styles.archiveName}>
              {pickedName ?? 'No archive selected'}
            </Text>
          </View>
          {useManualPath ? (
            <View style={styles.manualRow}>
              <TextInput
                testID="manual-archive-path"
                value={manualPath}
                onChangeText={setManualPath}
                placeholder="Enter archive path (.zip)"
                placeholderTextColor={viewerLight.textFaint}
                style={styles.manualInput}
              />
              <Pressable
                testID="manual-archive-apply"
                accessibilityLabel="Use this archive path"
                onPress={applyManualPath}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Use this path</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              testID="choose-archive"
              accessibilityLabel="Choose archive"
              disabled={isBusy}
              onPress={() => void pick()}
              style={[
                styles.secondaryButton,
                isBusy && styles.buttonDisabled,
              ]}>
              <Text style={styles.secondaryButtonText}>
                {isPicking ? 'Choosing...' : 'Choose archive'}
              </Text>
            </Pressable>
          )}
          <Pressable
            testID="import-archive"
            accessibilityLabel="Import archive"
            disabled={isBusy || pickedPath == null}
            onPress={importPicked}
            style={[
              styles.primaryButton,
              (isBusy || pickedPath == null) && styles.buttonDisabled,
            ]}>
            <Text style={styles.primaryButtonText}>
              {controller.isMutating ? 'Importing...' : 'Import archive'}
            </Text>
          </Pressable>
          <Text style={styles.dangerNote}>
            Import is destructive for collections present in the archive:
            matching local collections are replaced from archive data.
          </Text>
        </View>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Delete imported data</Text>
          <Text style={styles.panelBody}>
            Delete the imported archive data from this device and return the
            app to its import-first state.
          </Text>
          <Pressable
            testID="delete-imported-data"
            accessibilityLabel="Delete imported data"
            disabled={isBusy || dataset == null}
            onPress={deleteAll}
            style={[
              styles.dangerTonalButton,
              (isBusy || dataset == null) && styles.buttonDisabled,
            ]}>
            <Text style={styles.dangerTonalButtonText}>
              Delete imported data
            </Text>
          </Pressable>
        </View>
        {message != null ? (
          <View style={styles.panel}>
            <Text testID="import-message" style={styles.messageText}>
              {message}
            </Text>
          </View>
        ) : null}
        <Text testID="import-footer" style={styles.footer}>
          {`Note Harbor Viewer v${appManifest.version}`}
        </Text>
      </ScrollView>
      <ImportBlockingOverlay
        visible={isImporting}
        archiveName={pickedName}
        testID="import-blocking-overlay"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: viewerLight.pageBackground,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: viewerRadii.pill,
    backgroundColor: viewerLight.surfaceContainer,
  },
  backGlyph: {
    color: viewerLight.text,
    fontSize: 28,
    fontWeight: '700',
  },
  headerTitle: {
    color: viewerLight.text,
    fontSize: 20,
    fontWeight: '800',
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
  },
  panel: {
    gap: 10,
    borderRadius: viewerRadii.xl,
    borderWidth: 1.5,
    borderColor: viewerLight.border,
    padding: 20,
    marginBottom: 18,
    backgroundColor: viewerLight.surface,
  },
  panelTitle: {
    color: viewerLight.text,
    fontSize: 20,
    fontWeight: '800',
  },
  panelHeading: {
    color: viewerLight.text,
    fontSize: 22,
    fontWeight: '800',
  },
  panelBody: {
    color: viewerLight.text,
    fontSize: 14,
    lineHeight: 20,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  pill: {
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: viewerLight.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: viewerLight.surfaceContainer,
  },
  pillLabel: {
    color: viewerLight.text,
    fontSize: 12,
    fontWeight: '800',
  },
  pillValue: {
    color: viewerLight.text,
    fontSize: 14,
  },
  optionList: {
    gap: 8,
  },
  option: {
    borderRadius: viewerRadii.xs,
    borderWidth: 1,
    borderColor: viewerLight.borderControl,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: viewerLight.surface,
  },
  optionSelected: {
    borderColor: viewerLight.accent,
    backgroundColor: viewerLight.accentSoft,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionText: {
    color: viewerLight.text,
    fontSize: 15,
    fontWeight: '600',
  },
  optionTextSelected: {
    fontWeight: '800',
  },
  tonalButton: {
    borderRadius: viewerRadii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: viewerLight.surfaceContainer,
  },
  tonalButtonText: {
    color: viewerLight.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dangerTonalButton: {
    borderRadius: viewerRadii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: viewerLight.dangerSoft,
  },
  dangerTonalButtonText: {
    color: viewerLight.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  archiveBox: {
    borderRadius: viewerRadii.md,
    borderWidth: 1,
    borderColor: viewerLight.border,
    padding: 16,
    backgroundColor: viewerLight.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  archiveName: {
    color: viewerLight.text,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    borderRadius: viewerRadii.md,
    borderWidth: 1,
    borderColor: viewerLight.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: viewerLight.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    borderRadius: viewerRadii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: viewerLight.accent,
  },
  primaryButtonText: {
    color: viewerLight.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  dangerNote: {
    color: viewerLight.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  manualRow: {
    gap: 10,
  },
  manualInput: {
    borderRadius: viewerRadii.xs,
    borderWidth: 1,
    borderColor: viewerLight.borderControl,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: viewerLight.text,
    fontSize: 14,
    backgroundColor: viewerLight.surface,
  },
  messageText: {
    color: viewerLight.text,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    color: viewerLight.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
});
