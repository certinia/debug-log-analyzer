import { Aliases, AuthInfo, Connection, ConfigAggregator } from '@salesforce/core';

export class SFDXWorkspaceUtil {
  public async getDefaultUsername(): Promise<string | undefined> {
    const aggregator = await ConfigAggregator.create();
    const defaultusername = aggregator.getPropertyValue('defaultusername');

    if (typeof defaultusername == 'string') {
      return (await Aliases.fetch(defaultusername)) || defaultusername;
    }
    return undefined;
  }

  public async getConnection(): Promise<Connection | null> {
    const username = await this.getDefaultUsername();
    if (username !== undefined) {
      const connection = await Connection.create({
        authInfo: await AuthInfo.create({ username: username }),
      });
      return connection;
    } else {
      return null;
    }
  }
}
