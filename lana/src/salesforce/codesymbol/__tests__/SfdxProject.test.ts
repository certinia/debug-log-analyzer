/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace } from 'vscode';
import { SfdxProject } from '../SfdxProject';

jest.mock('vscode');

describe('SfdxProject', () => {
  let project: SfdxProject;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findClass', () => {
    beforeEach(() => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
      ]);
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
      const mockUri = { fsPath: '/workspace/force-app/classes/MyClass.cls' } as Uri;
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();
      const result = project.findClass('MyClass');

      expect(result).toHaveLength(1);
      expect(Uri.file).toHaveBeenCalledWith('/workspace/force-app/classes/MyClass.cls');
    });

    it('should return multiple Uris when class has multiple matches', async () => {
      const mockUris = [
        { fsPath: '/workspace/force-app/classes/MyClass.cls' } as Uri,
        { fsPath: '/workspace/another-app/classes/MyClass.cls' } as Uri,
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();
      const result = project.findClass('MyClass');

      expect(result).toHaveLength(2);
      expect(Uri.file).toHaveBeenCalledWith('/workspace/force-app/classes/MyClass.cls');
      expect(Uri.file).toHaveBeenCalledWith('/workspace/another-app/classes/MyClass.cls');
    });

    it('should properly convert file paths to Uri objects', async () => {
      const mockUri = { fsPath: '/workspace/force-app/classes/TestClass.cls' } as Uri;
      const expectedUri = { fsPath: '/workspace/force-app/classes/TestClass.cls' } as Uri;
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);
      (Uri.file as jest.Mock).mockReturnValue(expectedUri);

      await project.buildClassIndex();
      const result = project.findClass('TestClass');

      expect(result[0]).toBe(expectedUri);
    });
  });

  describe('buildClassIndex', () => {
    it('should build index from single package directory', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
      ]);

      const mockUris = [
        { fsPath: '/workspace/force-app/classes/Class1.cls' } as Uri,
        { fsPath: '/workspace/force-app/classes/Class2.cls' } as Uri,
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();

      expect(workspace.findFiles).toHaveBeenCalledTimes(1);
      expect(RelativePattern).toHaveBeenCalledWith('/workspace/force-app', '**/*.cls');

      const class1Result = project.findClass('Class1');
      const class2Result = project.findClass('Class2');

      expect(class1Result).toHaveLength(1);
      expect(class2Result).toHaveLength(1);
    });

    it('should build index from multiple package directories', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
        { path: '/workspace/another-app', default: false },
      ]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([{ fsPath: '/workspace/force-app/classes/Class1.cls' } as Uri])
        .mockResolvedValueOnce([{ fsPath: '/workspace/another-app/classes/Class2.cls' } as Uri]);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();

      expect(workspace.findFiles).toHaveBeenCalledTimes(2);
      expect(RelativePattern).toHaveBeenCalledWith('/workspace/force-app', '**/*.cls');
      expect(RelativePattern).toHaveBeenCalledWith('/workspace/another-app', '**/*.cls');

      expect(project.findClass('Class1')).toHaveLength(1);
      expect(project.findClass('Class2')).toHaveLength(1);
    });

    it('should handle multiple classes with the same name', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
        { path: '/workspace/another-app', default: false },
      ]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([
          { fsPath: '/workspace/force-app/classes/DuplicateClass.cls' } as Uri,
        ])
        .mockResolvedValueOnce([
          { fsPath: '/workspace/another-app/classes/DuplicateClass.cls' } as Uri,
        ]);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();

      const result = project.findClass('DuplicateClass');

      expect(result).toHaveLength(2);
    });

    it('should handle empty package directories', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/empty-app', default: true },
      ]);

      (workspace.findFiles as jest.Mock).mockResolvedValue([]);

      await project.buildClassIndex();

      const result = project.findClass('AnyClass');

      expect(result).toEqual([]);
    });

    it('should properly extract class name from .cls file paths', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
      ]);

      const mockUris = [
        { fsPath: '/workspace/force-app/classes/MyController.cls' } as Uri,
        { fsPath: '/workspace/force-app/classes/utils/StringUtil.cls' } as Uri,
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringUtil')).toHaveLength(1);
      expect(project.findClass('MyController.cls')).toHaveLength(0);
    });

    it('should clear previous cache when re-indexing', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
      ]);

      (workspace.findFiles as jest.Mock)
        .mockResolvedValueOnce([{ fsPath: '/workspace/force-app/classes/OldClass.cls' } as Uri])
        .mockResolvedValueOnce([{ fsPath: '/workspace/force-app/classes/NewClass.cls' } as Uri]);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();
      expect(project.findClass('OldClass')).toHaveLength(1);

      await project.buildClassIndex();
      const oldClassResult = project.findClass('OldClass');
      const newClassResult = project.findClass('NewClass');

      expect(oldClassResult).toHaveLength(0);
      expect(newClassResult).toHaveLength(1);
    });

    it('should use correct glob pattern for finding classes', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
      ]);

      (workspace.findFiles as jest.Mock).mockResolvedValue([]);

      await project.buildClassIndex();

      expect(RelativePattern).toHaveBeenCalledWith('/workspace/force-app', '**/*.cls');
    });

    it('should handle classes in nested directories', async () => {
      project = new SfdxProject('test-project', 'ns', [
        { path: '/workspace/force-app', default: true },
      ]);

      const mockUris = [
        { fsPath: '/workspace/force-app/classes/controllers/MyController.cls' } as Uri,
        { fsPath: '/workspace/force-app/classes/utils/helpers/StringHelper.cls' } as Uri,
      ];
      (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);
      (Uri.file as jest.Mock).mockImplementation((path) => ({ fsPath: path }) as Uri);

      await project.buildClassIndex();

      expect(project.findClass('MyController')).toHaveLength(1);
      expect(project.findClass('StringHelper')).toHaveLength(1);
    });
  });
});
