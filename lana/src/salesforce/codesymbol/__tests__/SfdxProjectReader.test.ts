/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import { getProjects } from '../SfdxProjectReader';

jest.mock('vscode');

describe('getProjects', () => {
  const mockWorkspaceFolder = {
    uri: { fsPath: '/workspace' },
    name: 'test-workspace',
    index: 0,
  } as WorkspaceFolder;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty array when no sfdx-project.json files found', async () => {
    (workspace.findFiles as jest.Mock).mockResolvedValue([]);

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toEqual([]);
    expect(RelativePattern).toHaveBeenCalledWith(mockWorkspaceFolder, '**/sfdx-project.json');
  });

  it('should parse valid sfdx-project.json files', async () => {
    const mockUri = { fsPath: '/workspace/sfdx-project.json' };
    const mockProjectContent = {
      name: 'my-project',
      namespace: 'myns',
      packageDirectories: [{ path: 'force-app', default: true }],
    };

    (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);
    (workspace.openTextDocument as jest.Mock).mockResolvedValue({
      getText: () => JSON.stringify(mockProjectContent),
    });
    (Uri.joinPath as jest.Mock).mockReturnValue({
      path: '/workspace/force-app/sfdx-project.json',
    });

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'my-project',
      namespace: 'myns',
      packageDirectories: [{ path: '/workspace/force-app', default: true }],
    });
  });

  it('should parse multiple sfdx-project.json files', async () => {
    const mockUris = [
      { fsPath: '/workspace/project1/sfdx-project.json' },
      { fsPath: '/workspace/project2/sfdx-project.json' },
    ];
    const mockProjects = [
      { name: 'project1', namespace: 'ns1', packageDirectories: [] },
      { name: 'project2', namespace: 'ns2', packageDirectories: [] },
    ];

    (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);
    (workspace.openTextDocument as jest.Mock)
      .mockResolvedValueOnce({ getText: () => JSON.stringify(mockProjects[0]) })
      .mockResolvedValueOnce({ getText: () => JSON.stringify(mockProjects[1]) });
    (Uri.joinPath as jest.Mock).mockReturnValue({ path: '/workspace/sfdx-project.json' });

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject(mockProjects[0]!);
    expect(result[1]).toMatchObject(mockProjects[1]!);
  });

  it('should skip invalid JSON files and log warning', async () => {
    const mockUri = { fsPath: '/workspace/invalid/sfdx-project.json' };
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);
    (workspace.openTextDocument as jest.Mock).mockResolvedValue({
      getText: () => 'invalid json',
    });

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse sfdx-project.json'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should continue processing other files when one fails', async () => {
    const mockUris = [
      { fsPath: '/workspace/invalid/sfdx-project.json' },
      { fsPath: '/workspace/valid/sfdx-project.json' },
    ];
    const validProject = { name: 'valid', namespace: '', packageDirectories: [] };
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    (workspace.findFiles as jest.Mock).mockResolvedValue(mockUris);
    (workspace.openTextDocument as jest.Mock)
      .mockResolvedValueOnce({ getText: () => 'invalid json' })
      .mockResolvedValueOnce({ getText: () => JSON.stringify(validProject) });
    (Uri.joinPath as jest.Mock).mockReturnValue({ path: '/workspace/sfdx-project.json' });

    const result = await getProjects(mockWorkspaceFolder);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(validProject);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
