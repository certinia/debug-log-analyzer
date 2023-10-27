import type { LogLine } from './ApexLogParser';

export class ApexLog {
  /**
   *  The Total time (wall time) taken in the log, in nanos seconds.
   */
  public totalDuration: number = 0;

  /**
   * The size of the log, in bytes
   */
  public size: number = 0;

  public children: LogLine[] = [];
}
