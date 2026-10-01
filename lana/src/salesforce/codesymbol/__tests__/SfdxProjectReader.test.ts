/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import type { SfdxProject } from '../SfdxProject';
import { getProjects } from '../SfdxProjectReader';

/** Mock the workspace scan so each project file resolves to its own contents, in order. */
function mockProjectFiles(files: { path: string; contents: string }[]): void {
  (workspace.findFiles as jest.Mock).mockResolvedValue(files.map((file) => Uri.file(file.path)));

  const readFile = workspace.fs.readFile as jest.Mock;
  for (const file of files) {
    readFile.mockResolvedValueOnce(new TextEncoder().encode(file.contents));
  }
}

const packagePaths = (project: SfdxProject | undefined) =>
  project?.packageDirectories.map((dir) => ({ path: dir.uri.path, default: dir.default }));

describe('getProjects', () => {
  const mockWorkspaceFolder = {
    uri: { fsPath: '/workspace' },
    name: 'test-workspace',
    index: 0,
  } as WorkspaceFolder;

  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('finds nothing when the workspace has no sfdx-project.json', async () => {
    mockProjectFiles([]);

    expect(await getProjects(mockWorkspaceFolder)).toEqual([]);
    expect(RelativePattern).toHaveBeenCalledWith(mockWorkspaceFolder, '**/sfdx-project.json');
  });

  it('reads a project with its name, namespace and package directories', async () => {
    mockProjectFiles([
      {
        path: '/workspace/sfdx-project.json',
        contents: JSON.stringify({
          name: 'my-project',
          namespace: 'myns',
          packageDirectories: [{ path: 'force-app', default: true }],
        }),
      },
    ]);

    const [project] = await getProjects(mockWorkspaceFolder);

    expect(project).toMatchObject({ name: 'my-project', namespace: 'myns' });
    expect(packagePaths(project)).toEqual([{ path: '/workspace/force-app', default: true }]);
  });

  it('resolves package directories relative to a nested project file', async () => {
    mockProjectFiles([
      {
        path: '/workspace/packages/pkg-a/sfdx-project.json',
        contents: JSON.stringify({
          name: 'pkg-a',
          namespace: '',
          packageDirectories: [{ path: 'src/main', default: true }],
        }),
      },
    ]);

    const [project] = await getProjects(mockWorkspaceFolder);

    expect(packagePaths(project)).toEqual([
      { path: '/workspace/packages/pkg-a/src/main', default: true },
    ]);
  });

  it('defaults a missing name, namespace and package default flag', async () => {
    mockProjectFiles([
      {
        path: '/workspace/sfdx-project.json',
        contents: JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }),
      },
    ]);

    const [project] = await getProjects(mockWorkspaceFolder);

    expect(project).toMatchObject({ name: null, namespace: '' });
    expect(packagePaths(project)).toEqual([{ path: '/workspace/force-app', default: false }]);
  });

  it.each([
    ['invalid JSON', 'invalid json'],
    [
      'no packageDirectories array',
      JSON.stringify({ name: 'no-dirs', packageDirectories: 'force-app' }),
    ],
  ])(
    'warns about and skips a project file with %s, then reads the rest',
    async (_label, contents) => {
      const validProject = { name: 'valid', namespace: '', packageDirectories: [] };
      mockProjectFiles([
        { path: '/workspace/broken/sfdx-project.json', contents },
        { path: '/workspace/valid/sfdx-project.json', contents: JSON.stringify(validProject) },
      ]);

      const projects = await getProjects(mockWorkspaceFolder);

      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject(validProject);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse sfdx-project.json'),
        expect.any(Error),
      );
    },
  );
});
