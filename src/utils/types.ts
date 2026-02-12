// "Omit" is not distributive over unions.
// The fix is to wrap Omit in a distributive conditional type so it is applied to each union member individually.
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
