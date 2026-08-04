/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, type Uri, workspace } from 'vscode';
import { SfdxProject } from '../SfdxProject';

jest.mock('vscode');

const dirUri = (path: string): Uri => ({ path, fsPath: path }) as Uri;
const clsUri = (path: string): Uri => ({ path, fsPath: path }) as Uri;

describe('SfdxProject', () => {
  let project: SfdxProject;

  const forceAppUri = dirUri('/workspace/force-app');
  const anotherAppUri = dirUri('/workspace/another-app');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findClass', () => {
    beforeEach(() => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);
    });

    it('should return empty array when class not in cache', () => {
      const result = project.findClass('NonExistentClass');

      expect(result).toEqual([]);
    });

    it('should return empty array before buildClassIndex is called', () => {
      const result = project.findClass('MyClass');

      expect(result).toEqual([]);
    });

    it('should return single Uri when class has one match', async () => {
      const mockUri = clsUri('/workspace/force-app/classes/MyClass.cls');
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);

      await project.buildClassIndex();
      const result = project.findClass('MyClass');

      expect(result).toEqual([mockUri]);
    });

    it('should return multiple Uris when class has multiple matches', async () => {
      const mockUris = [
        clsUri('/workspace/force-app/classes/MyClass.cls'),
        clsUri('/workspace/another-app/classes/MyClass.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();
      const result = project.findClass('MyClass');

      expect(result).toEqual(mockUris);
    });

    it('should return the indexed Uri objects unchanged', async () => {
      const mockUri = clsUri('/workspace/force-app/classes/TestClass.cls');
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);

      await project.buildClassIndex();
      const result = project.findClass('TestClass');

      expect(result[0]).toBe(mockUri);
    });
  });

  describe('buildClassIndex', () => {
    it('should build index from single package directory', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      const mockUris = [
        clsUri('/workspace/force-app/classes/Class1.cls'),
        clsUri('/workspace/force-app/classes/Class2.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();

      expect(workspace.findFiles).toHaveBeenCalledTimes(1);
      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');

      expect(project.findClass('Class1')).toHaveLength(1);
      expect(project.findClass('Class2')).toHaveLength(1);
    });

    it('should build index from multiple package directories', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { uri: forceAppUri, default: true },
        { uri: anotherAppUri, default: false },
      ]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([clsUri('/workspace/force-app/classes/Class1.cls')])
        .mockResolvedValueOnce([clsUri('/workspace/another-app/classes/Class2.cls')]);

      await project.buildClassIndex();

      expect(workspace.findFiles).toHaveBeenCalledTimes(2);
      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');
      expect(RelativePattern).toHaveBeenCalledWith(anotherAppUri, '**/*.cls');

      expect(project.findClass('Class1')).toHaveLength(1);
      expect(project.findClass('Class2')).toHaveLength(1);
    });

    it('should handle multiple classes with the same name', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { uri: forceAppUri, default: true },
        { uri: anotherAppUri, default: false },
      ]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([clsUri('/workspace/force-app/classes/DuplicateClass.cls')])
        .mockResolvedValueOnce([clsUri('/workspace/another-app/classes/DuplicateClass.cls')]);

      await project.buildClassIndex();

      const result = project.findClass('DuplicateClass');

      expect(result).toHaveLength(2);
    });

    it('should handle empty package directories', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { uri: dirUri('/workspace/empty-app'), default: true },
      ]);

      (workspace.findFiles as jest.Mock).mockResolvedValue([]);

      await project.buildClassIndex();

      const result = project.findClass('AnyClass');

      expect(result).toEqual([]);
    });

    it('should properly extract class name from .cls file paths', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      const mockUris = [
        clsUri('/workspace/force-app/classes/MyController.cls'),
        clsUri('/workspace/force-app/classes/utils/StringUtil.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringUtil')).toHaveLength(1);
      expect(project.findClass('MyController.cls')).toHaveLength(0);
    });

    it('should clear previous cache when re-indexing', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([clsUri('/workspace/force-app/classes/OldClass.cls')])
        .mockResolvedValueOnce([clsUri('/workspace/force-app/classes/NewClass.cls')]);

      await project.buildClassIndex();
      expect(project.findClass('OldClass')).toHaveLength(1);

      await project.buildClassIndex();

      expect(project.findClass('OldClass')).toHaveLength(0);
      expect(project.findClass('NewClass')).toHaveLength(1);
    });

    it('should keep the previous index when a findFiles call rejects', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([clsUri('/workspace/force-app/classes/MyClass.cls')])
        .mockRejectedValueOnce(new Error('glob failed'));

      await project.buildClassIndex();
      await expect(project.buildClassIndex()).rejects.toThrow('glob failed');

      expect(project.findClass('MyClass')).toHaveLength(1);
    });

    it('should index successfully on retry after a rejected build', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      (workspace.findFiles as jest.Mock)
        .mockRejectedValueOnce(new Error('glob failed'))
        .mockResolvedValueOnce([clsUri('/workspace/force-app/classes/MyClass.cls')]);

      await expect(project.buildClassIndex()).rejects.toThrow('glob failed');
      expect(project.findClass('MyClass')).toEqual([]);

      await project.buildClassIndex();
      expect(project.findClass('MyClass')).toHaveLength(1);
    });

    it('should use correct glob pattern for finding classes', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      (workspace.findFiles as jest.Mock).mockResolvedValue([]);

      await project.buildClassIndex();

      expect(RelativePattern).toHaveBeenCalledWith(forceAppUri, '**/*.cls');
    });

    it('should handle classes in nested directories', async () => {
      project = new SfdxProject('test-project', 'ns', [{ uri: forceAppUri, default: true }]);

      const mockUris = [
        clsUri('/workspace/force-app/classes/controllers/MyController.cls'),
        clsUri('/workspace/force-app/classes/utils/helpers/StringHelper.cls'),
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringHelper')).toHaveLength(1);
    });
  });
});
