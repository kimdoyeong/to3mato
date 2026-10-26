export function createSupabaseTransport(client, userId) {
  const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  return {
    async pull({ epoch, cursor, deviceId, timeZone }) {
      return unwrap(
        await client.rpc('sync_pull', {
          p_epoch: epoch,
          p_cursor: cursor,
          p_device: deviceId,
          p_timezone: timeZone,
        }),
      );
    },
    async push({ operation, epoch }) {
      return unwrap(
        await client.rpc('sync_push', {
          p_operation: operation,
          p_epoch: epoch,
        }),
      );
    },
    subscribe(onChange, onConnection) {
      const channel = client.channel(`account:${userId}`, {
        config: { private: true },
      });
      channel
        .on('broadcast', { event: 'changed' }, onChange)
        .subscribe((status) => onConnection(status === 'SUBSCRIBED'));
      return {
        unsubscribe: () => {
          void client.removeChannel(channel);
        },
      };
    },
  };
}
