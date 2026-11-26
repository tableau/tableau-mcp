describe('RestApi', () => {
  it('exposes Subscriptions API methods', async () => {
    const { RestApi } = await vi.importActual<typeof import('./restApi.js')>('./restApi.js');
    expect(
      Object.getOwnPropertyDescriptor(RestApi.prototype, 'subscriptionsMethods')?.get,
    ).toBeTypeOf('function');
  });
  it('exposes Knowledge API methods', async () => {
    const { RestApi } = await vi.importActual<typeof import('./restApi.js')>('./restApi.js');

    expect(Object.getOwnPropertyDescriptor(RestApi.prototype, 'knowledgeMethods')?.get).toBeTypeOf(
      'function',
    );
  });
});
