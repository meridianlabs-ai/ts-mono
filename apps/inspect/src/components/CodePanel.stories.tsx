import "prismjs/themes/prism.css";

import type { Meta, StoryObj } from "@storybook/react";

import { CodePanel } from "./CodePanel";

const meta = {
  title: "Components/CodePanel",
  component: CodePanel,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CodePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const JsonExample: Story = {
  args: {
    code: `{
  "model": "gpt-4o",
  "temperature": 0.7,
  "max_tokens": 1024,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is the capital of France?" }
  ]
}`,
    language: "json",
  },
};

export const Python: Story = {
  args: {
    code: `def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(10))`,
    language: "python",
  },
};

export const LongCode: Story = {
  args: {
    code: `import { useState, useEffect, useCallback } from "react";

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

function SearchInput({ onSearch }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  const handleSearch = useCallback(() => {
    if (debouncedQuery.trim()) {
      onSearch(debouncedQuery);
    }
  }, [debouncedQuery, onSearch]);

  useEffect(() => {
    handleSearch();
  }, [handleSearch]);

  return (
    <input
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search..."
    />
  );
}

export default SearchInput;`,
    language: "javascript",
  },
};
