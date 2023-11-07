import type { DebugLevel, LogLine, RootNode, TruncationEntry } from './ApexLogParser';

export class ApexLog {
  public rootNode: RootNode;
  /**
   *  The Total time (wall time) taken in the log, in nanos seconds.
   */
  public totalDuration: number = 0;

  /**
   * The size of the log, in bytes
   */
  public size: number = 0;

  public cpuTime: number = 0;

  public children: LogLine[] = [];

  public debugLevels: DebugLevel[] = [];
  public truncated: TruncationEntry[] = [];

  public constructor(root: RootNode) {
    this.rootNode = root;
  }
}
