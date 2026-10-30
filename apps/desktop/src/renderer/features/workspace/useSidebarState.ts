import { useState } from 'react';

export function useSidebarState() {
  const [searchFocused, setSearchFocused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  return { searchFocused, setSearchFocused, collapsed, setCollapsed, query, setQuery };
}
