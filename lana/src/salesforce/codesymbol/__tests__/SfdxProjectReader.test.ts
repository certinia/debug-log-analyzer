/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import { getProjects } from '../SfdxProjectReader';

jest.mock('vscode');

const fileUri = (path: string): Uri => ({ path, fsPath: path }) as Uri;

const joinPath = (base: string, ...segments: string[]): string =>
  [base, ...segments].join('/').replace(/\/[^/]+\/\.\.\//g, '/');

/** Mock the workspace scan so each project file resolves to its own contents, in order. */
function mockProjectFiles(files: { uri: Uri; contents: string }[]): void {
  (workspace.findFiles as jest.Mock).mockResolvedValue(files.map((file) => file.uri));

  const readFile = workspace.fs.readFile as jest.Mock;
  for (const file of files) {
    readFile.mockResolvedValueOnce(new TextEncoder().encode(file.contents));
  }
}

describe('getProjects', () => {
  const mockWorkspaceFolder = {
    uri: { fsPath: '/workspace' },
    name: 'test-workspace',
    index: 0,
  } as WorkspaceFolder;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mirror the real Uri.joinPath: join segments and normalize '..'
    (Uri.joinPath as jest.Mock).mockImplementation((base: Uri, ...segments: string[]) =>
      fileUri(joinPath(base.path, ...segments)),
    );
  });

  it('should return empty array when no sfdx-project.json files found', async () => {
    mockProjectFiles([]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toEqual([]);
    expect(RelativePattern).toHaveBeenCalledWith(mockWorkspaceFolder, '**/sfdx-project.json');
  });

  it('should parse valid sfdx-project.json files', async () => {
    const mockProjectContent = {
      name: 'my-project',
      namespace: 'myns',
      packageDirectories: [{ path: 'force-app', default: true }],
    };

    mockProjectFiles([
      {
        uri: fileUri('/workspace/sfdx-project.json'),
        contents: JSON.stringify(mockProjectContent),
      },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'my-project',
      namespace: 'myns',
      packageDirectories: [{ uri: fileUri('/workspace/force-app'), default: true }],
    });
  });

  it('should resolve package directories relative to a nested project file', async () => {
    const mockProjectContent = {
      name: 'pkg-a',
      namespace: '',
      packageDirectories: [{ path: 'src/main', default: true }],
    };

    mockProjectFiles([
      {
        uri: fileUri('/workspace/packages/pkg-a/sfdx-project.json'),
        contents: JSON.stringify(mockProjectContent),
      },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(1);
    expect(result[0]?.packageDirectories).toEqual([
      { uri: fileUri('/workspace/packages/pkg-a/src/main'), default: true },
    ]);
  });

  it('should default missing name, namespace and package default flags', async () => {
    const mockProjectContent = {
      packageDirectories: [{ path: 'force-app' }],
    };

    mockProjectFiles([
      {
        uri: fileUri('/workspace/sfdx-project.json'),
        contents: JSON.stringify(mockProjectContent),
      },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: null,
      namespace: '',
      packageDirectories: [{ uri: fileUri('/workspace/force-app'), default: false }],
    });
  });

  it('should parse multiple sfdx-project.json files', async () => {
    const mockProjects = [
      { name: 'project1', namespace: 'ns1', packageDirectories: [] },
      { name: 'project2', namespace: 'ns2', packageDirectories: [] },
    ];

    mockProjectFiles([
      {
        uri: fileUri('/workspace/project1/sfdx-project.json'),
        contents: JSON.stringify(mockProjects[0]),
      },
      {
        uri: fileUri('/workspace/project2/sfdx-project.json'),
        contents: JSON.stringify(mockProjects[1]),
      },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject(mockProjects[0]!);
    expect(result[1]).toMatchObject(mockProjects[1]!);
  });

  it('should skip invalid JSON files and log warning', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    mockProjectFiles([
      { uri: fileUri('/workspace/invalid/sfdx-project.json'), contents: 'invalid json' },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse sfdx-project.json'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should skip project files without a packageDirectories array', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    mockProjectFiles([
      {
        uri: fileUri('/workspace/sfdx-project.json'),
        contents: JSON.stringify({ name: 'no-dirs', packageDirectories: 'force-app' }),
      },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse sfdx-project.json'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should continue processing other files when one fails', async () => {
    const validProject = { name: 'valid', namespace: '', packageDirectories: [] };
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    mockProjectFiles([
      { uri: fileUri('/workspace/invalid/sfdx-project.json'), contents: 'invalid json' },
      {
        uri: fileUri('/workspace/valid/sfdx-project.json'),
        contents: JSON.stringify(validProject),
      },
    ]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(validProject);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
