import { useParams } from "react-router";

export function useRequiredParams<T extends string>(
  ...keys: T[]
): Record<T, string> {
  const params = useParams();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/consistent-type-assertions -- a mapped type over a generic union has no empty value to start from; the loop below fills every key or throws
  const result = {} as Record<T, string>;

  for (const key of keys) {
    const value = params[key];
    if (!value) {
      throw new Error(`Missing required route param: ${key}`);
    }
    result[key] = value;
  }

  return result;
}
