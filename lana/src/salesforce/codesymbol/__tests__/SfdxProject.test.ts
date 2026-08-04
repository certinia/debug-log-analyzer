/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, type Uri, workspace } from 'vscode';
import { SfdxProject } from '../SfdxProject';

jest.mock('vscode');

const fileUri = (path: string): Uri => ({ path, fsPath: path }) as Uri;

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
    jest.clearAllMocks();
    project = createProject([forceAppUri]);
  });

  describe('findClass', () => {
    it('should return empty array when class not in cache', () => {
      const result = project.findClass('NonExistentClass');

      expect(result).toEqual([]);
    });

    it('should return empty array before buildClassIndex is called', () => {
      const result = project.findClass('MyClass');

      expect(result).toEqual([]);
    });

    it('should return single Uri when class has one match', async () => {
      const mockUri = fileUri('/workspace/force-app/classes/MyClass.cls');
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);

      await project.buildClassIndex();
      const result = project.findClass('MyClass');

      expect(result).toEqual([mockUri]);
    });

    it('should return multiple Uris when class has multiple matches', async () => {
      const mockUris = [
        fileUri('/workspace/force-app/classes/MyClass.cls'),
        fileUri('/workspace/another-app/classes/MyClass.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();
      const result = project.findClass('MyClass');

      expect(result).toEqual(mockUris);
    });

    it('should match class names case-insensitively', async () => {
      const mockUri = fileUri('/workspace/force-app/classes/MyClass.cls');
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);

      await project.buildClassIndex();

      expect(project.findClass('myclass')).toEqual([mockUri]);
      expect(project.findClass('MYCLASS')).toEqual([mockUri]);
    });

    it('should return the indexed Uri objects unchanged', async () => {
      const mockUri = fileUri('/workspace/force-app/classes/TestClass.cls');
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);

      await project.buildClassIndex();
      const result = project.findClass('TestClass');

      expect(result[0]).toBe(mockUri);
    });
  });

  describe('buildClassIndex', () => {
    it('should build index from single package directory', async () => {
      const mockUris = [
        fileUri('/workspace/force-app/classes/Class1.cls'),
        fileUri('/workspace/force-app/classes/Class2.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();

      expect(workspace.findFiles).toHaveBeenCalledTimes(1);
      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');

      expect(project.findClass('Class1')).toHaveLength(1);
      expect(project.findClass('Class2')).toHaveLength(1);
    });

    it('should build index from multiple package directories', async () => {
      project = createProject([forceAppUri, anotherAppUri]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/Class1.cls')])
        .mockResolvedValueOnce([fileUri('/workspace/another-app/classes/Class2.cls')]);

      await project.buildClassIndex();

      expect(workspace.findFiles).toHaveBeenCalledTimes(2);
      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');
      expect(RelativePattern).toHaveBeenCalledWith(anotherAppUri, '**/*.cls');

      expect(project.findClass('Class1')).toHaveLength(1);
      expect(project.findClass('Class2')).toHaveLength(1);
    });

    it('should handle multiple classes with the same name', async () => {
      project = createProject([forceAppUri, anotherAppUri]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/DuplicateClass.cls')])
        .mockResolvedValueOnce([fileUri('/workspace/another-app/classes/DuplicateClass.cls')]);

      await project.buildClassIndex();

      const result = project.findClass('DuplicateClass');

      expect(result).toHaveLength(2);
    });

    it('should handle empty package directories', async () => {
      project = createProject([fileUri('/workspace/empty-app')]);

      (workspace.findFiles as jest.Mock).mockResolvedValue([]);

      await project.buildClassIndex();

      const result = project.findClass('AnyClass');

      expect(result).toEqual([]);
    });

    it('should properly extract class name from .cls file paths', async () => {
      const mockUris = [
        fileUri('/workspace/force-app/classes/MyController.cls'),
        fileUri('/workspace/force-app/classes/utils/StringUtil.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringUtil')).toHaveLength(1);
      expect(project.findClass('MyController.cls')).toHaveLength(0);
    });

    it('should clear previous cache when re-indexing', async () => {
      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/OldClass.cls')])
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/NewClass.cls')]);

      await project.buildClassIndex();
      expect(project.findClass('OldClass')).toHaveLength(1);

      await project.buildClassIndex();

      expect(project.findClass('OldClass')).toHaveLength(0);
      expect(project.findClass('NewClass')).toHaveLength(1);
    });

    it('should keep the previous index when a findFiles call rejects', async () => {
      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/MyClass.cls')])
        .mockRejectedValueOnce(new Error('glob failed'));

      await project.buildClassIndex();
      await expect(project.buildClassIndex()).rejects.toThrow('glob failed');

      expect(project.findClass('MyClass')).toHaveLength(1);
    });

    it('should index successfully on retry after a rejected build', async () => {
      (workspace.findFiles as jest.Mock)
        .mockRejectedValueOnce(new Error('glob failed'))
        .mockResolvedValueOnce([fileUri('/workspace/force-app/classes/MyClass.cls')]);

      await expect(project.buildClassIndex()).rejects.toThrow('glob failed');
      expect(project.findClass('MyClass')).toEqual([]);

      await project.buildClassIndex();
      expect(project.findClass('MyClass')).toHaveLength(1);
    });

    it('should use correct glob pattern for finding classes', async () => {
      (workspace.findFiles as jest.Mock).mockResolvedValue([]);

      await project.buildClassIndex();

      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');
    });

    it('should handle classes in nested directories', async () => {
      const mockUris = [
        fileUri('/workspace/force-app/classes/controllers/MyController.cls'),
        fileUri('/workspace/force-app/classes/utils/helpers/StringHelper.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringHelper')).toHaveLength(1);
    });
  });
});
