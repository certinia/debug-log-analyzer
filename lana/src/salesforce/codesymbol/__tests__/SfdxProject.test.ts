/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, type Uri, workspace } from 'vscode';
import { SfdxProject } from '../SfdxProject';

const fileUri = (path: string): Uri => ({ path, fsPath: path }) as Uri;
const mockFindFiles = workspace.findFiles as jest.Mock;

function createProject(packageDirUris: Uri[]): SfdxProject {
  return new SfdxProject(
    'test-project',
    'ns',
    packageDirUris.map((uri, index) => ({ uri, default: index === 0 })),
  );
}

describe('SfdxProject', () => {
  let project: SfdxProject;

  const forceAppUri = fileUri('/workspace/force-app');
  const anotherAppUri = fileUri('/workspace/another-app');

  beforeEach(() => {
    project = createProject([forceAppUri]);
  });

  describe('findClass', () => {
    it('finds nothing before the index is built', () => {
      expect(project.findClass('MyClass')).toEqual([]);
    });

    it('returns the indexed Uri for a class, matching its name case-insensitively', async () => {
      const mockUri = fileUri('/workspace/force-app/classes/MyClass.cls');
      mockFindFiles.mockResolvedValue([mockUri]);

      await project.buildClassIndex();

      expect(project.findClass('MyClass')[0]).toBe(mockUri);
      expect(project.findClass('myclass')).toEqual([mockUri]);
      expect(project.findClass('MYCLASS')).toEqual([mockUri]);
      expect(project.findClass('NonExistentClass')).toEqual([]);
    });
  });

  describe('buildClassIndex', () => {
    it('searches every package directory for .cls files', async () => {
      project = createProject([forceAppUri, anotherAppUri]);
      mockFindFiles
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/Class1.cls')])
        .mockResolvedValueOnce([fileUri('/workspace/another-app/classes/Class2.cls')]);

      await project.buildClassIndex();

      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');
      expect(RelativePattern).toHaveBeenCalledWith(anotherAppUri, '**/*.cls');
      expect(project.findClass('Class1')).toHaveLength(1);
      expect(project.findClass('Class2')).toHaveLength(1);
    });

    it('keeps every file for a class name found in more than one directory', async () => {
      project = createProject([forceAppUri, anotherAppUri]);
      const duplicates = [
        fileUri('/workspace/force-app/classes/DuplicateClass.cls'),
        fileUri('/workspace/another-app/classes/DuplicateClass.cls'),
      ];
      mockFindFiles.mockResolvedValueOnce([duplicates[0]]).mockResolvedValueOnce([duplicates[1]]);

      await project.buildClassIndex();

      expect(project.findClass('DuplicateClass')).toEqual(duplicates);
    });

    it('names a class by its file name at any depth, without the extension', async () => {
      mockFindFiles.mockResolvedValue([
        fileUri('/workspace/force-app/classes/MyController.cls'),
        fileUri('/workspace/force-app/classes/utils/helpers/StringHelper.cls'),
      ]);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringHelper')).toHaveLength(1);
      expect(project.findClass('MyController.cls')).toHaveLength(0);
    });

    it('replaces the previous index when re-indexing', async () => {
      mockFindFiles
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/OldClass.cls')])
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/NewClass.cls')]);

      await project.buildClassIndex();
      expect(project.findClass('OldClass')).toHaveLength(1);
      await project.buildClassIndex();

      expect(project.findClass('OldClass')).toHaveLength(0);
      expect(project.findClass('NewClass')).toHaveLength(1);
    });

    it('keeps the previous index when a findFiles call rejects', async () => {
      mockFindFiles
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/MyClass.cls')])
        .mockRejectedValueOnce(new Error('glob failed'));

      await project.buildClassIndex();
      await expect(project.buildClassIndex()).rejects.toThrow('glob failed');

      expect(project.findClass('MyClass')).toHaveLength(1);
    });

    it('indexes on retry after a rejected build', async () => {
      mockFindFiles
        .mockRejectedValueOnce(new Error('glob failed'))
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/MyClass.cls')]);

      await expect(project.buildClassIndex()).rejects.toThrow('glob failed');
      expect(project.findClass('MyClass')).toEqual([]);

      await project.buildClassIndex();
      expect(project.findClass('MyClass')).toHaveLength(1);
    });
  });
});
