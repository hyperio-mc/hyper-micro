/**
 * Full-Text Search Benchmark for hyper-micro
 * Comparing: FlexSearch, lmdb-index, and MiniSearch
 */

import { performance } from 'perf_hooks';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Types
interface TestDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  author: string;
  createdAt: string;
}

interface BenchmarkResult {
  name: string;
  indexTime: number;
  queryExact: number;
  queryPrefix: number;
  queryFuzzy: number;
  memoryMB: number;
  persistTime?: number;
  loadTime?: number;
  resultCount: { exact: number; prefix: number; fuzzy: number };
  notes: string[];
}

// Test data generator
function generateDocuments(count: number): TestDocument[] {
  const categories = ['technology', 'science', 'politics', 'sports', 'entertainment', 'health', 'business', 'education'];
  const tags = ['trending', 'featured', 'breaking', 'analysis', 'opinion', 'review', 'guide', 'tutorial'];
  const authors = ['Alice Johnson', 'Bob Smith', 'Carol White', 'David Brown', 'Eve Davis', 'Frank Miller', 'Grace Lee', 'Henry Wilson'];
  
  const titles = [
    'The Future of Artificial Intelligence',
    'Climate Change and Global Policy',
    'Revolutionary Cancer Treatment Discovered',
    'New Economic Policy Released',
    'SpaceX Launches New Satellite',
    'Breaking: Major Technology Update',
    'Sports Championship Finals Recap',
    'Entertainment Industry Trends',
    'Healthcare Reform Updates',
    'Education System Changes Proposed'
  ];
  
  const documents: TestDocument[] = [];
  
  for (let i = 0; i < count; i++) {
    const titleIdx = i % titles.length;
    const title = titles[titleIdx] + ' - Part ' + Math.floor(i / titles.length + 1);
    
    // Simple content without template variables
    const content = 'This article discusses the latest developments. ' +
      'Experts believe that significant changes are coming. ' +
      'The implications are far-reaching for many areas. ' +
      'Topic index: ' + (i % 50) + '. ' +
      'Research indicates finding number ' + (i % 100) + '. ' +
      'This could change how we approach problems. ' +
      'Additional paragraph with more details about the subject. '.repeat(3 + (i % 5));
    
    documents.push({
      id: 'doc-' + i.toString().padStart(5, '0'),
      title: title,
      content: content,
      category: categories[i % categories.length],
      tags: [tags[i % tags.length], tags[(i + 1) % tags.length]],
      author: authors[i % authors.length],
      createdAt: new Date(2024, 0, 1 + (i % 365)).toISOString()
    });
  }
  
  return documents;
}

function getMemoryUsageMB(): number {
  const used = process.memoryUsage();
  return Math.round((used.heapUsed / 1024 / 1024) * 100) / 100;
}

async function runBenchmarks(docCount: number = 10000): Promise<BenchmarkResult[]> {
  const separator = '='.repeat(60);
  console.log('\n' + separator);
  console.log('Full-Text Search Benchmark - ' + docCount.toLocaleString() + ' Documents');
  console.log(separator + '\n');
  
  const documents = generateDocuments(docCount);
  const results: BenchmarkResult[] = [];
  
  // =====================
  // FlexSearch Benchmark
  // =====================
  console.log('Testing FlexSearch...');
  const flexResult = await benchmarkFlexSearch(documents);
  results.push(flexResult);
  
  // Force garbage collection between tests
  if ((global as any).gc) (global as any).gc();
  
  // =====================
  // MiniSearch Benchmark
  // =====================
  console.log('Testing MiniSearch...');
  const miniResult = await benchmarkMiniSearch(documents);
  results.push(miniResult);
  
  // Force garbage collection between tests
  if ((global as any).gc) (global as any).gc();
  
  // =====================
  // lmdb-index Benchmark
  // =====================
  console.log('Testing lmdb-index...');
  const lmdbResult = await benchmarkLmdbIndex(documents);
  results.push(lmdbResult);
  
  return results;
}

async function benchmarkFlexSearch(documents: TestDocument[]): Promise<BenchmarkResult> {
  const notes: string[] = [];
  const memStart = getMemoryUsageMB();
  
  // Dynamic import for ESM
  const flexsearch = await import('flexsearch');
  const FlexDocument = flexsearch.Document;
  
  // Create document index
  const index = new FlexDocument({
    document: {
      id: 'id',
      index: ['title', 'content', 'category', 'author'],
      store: ['title', 'category', 'author']
    },
    tokenize: 'forward',
    charset: 'latin:extra'
  });
  
  // Benchmark indexing
  const indexStart = performance.now();
  for (const doc of documents) {
    index.add(doc.id, {
      title: doc.title,
      content: doc.content,
      category: doc.category,
      author: doc.author
    });
  }
  const indexTime = performance.now() - indexStart;
  
  const memAfterIndex = getMemoryUsageMB();
  
  // Benchmark queries
  const queryStart1 = performance.now();
  const exactResults = index.search('artificial intelligence', { limit: 100 });
  const queryExact = performance.now() - queryStart1;
  
  const queryStart2 = performance.now();
  //FlexSearch prefix search using tokenize: 'forward' allows prefix matching
  const prefixResults = index.search('artif', { limit: 100 });
  const queryPrefix = performance.now() - queryStart2;
  
  const queryStart3 = performance.now();
  // FlexSearch doesn't have built-in fuzzy, test with misspelling
  const fuzzyResults = index.search('inteligence', { limit: 100 });
  const queryFuzzy = performance.now() - queryStart3;
  
  // Test serialization (export/import)
  const persistStart = performance.now();
  let persistTime = 0;
  let loadTime = 0;
  
  try {
    const exportData: Record<string, string> = {};
    (index as any).export((key: string, data: string) => {
      exportData[key] = data;
    });
    const jsonData = JSON.stringify(exportData);
    persistTime = performance.now() - persistStart;
    notes.push('Export size: ' + Math.round(jsonData.length / 1024) + 'KB');
    
    // Test load
    const loadStart = performance.now();
    const newIndex = new FlexDocument({
      document: {
        id: 'id',
        index: ['title', 'content', 'category', 'author'],
        store: ['title', 'category', 'author']
      },
      tokenize: 'forward',
      charset: 'latin:extra'
    });
    const parsed = JSON.parse(jsonData);
    (newIndex as any).import(Object.keys(parsed).map(k => ({ key: k, data: parsed[k] })));
    loadTime = performance.now() - loadStart;
  } catch (err) {
    notes.push('Persistence test failed: ' + (err instanceof Error ? err.message : String(err)));
  }
  
  const memEnd = getMemoryUsageMB();
  
  return {
    name: 'FlexSearch',
    indexTime,
    queryExact,
    queryPrefix,
    queryFuzzy,
    memoryMB: memEnd - memStart,
    persistTime,
    loadTime,
    resultCount: {
      exact: Array.isArray(exactResults) ? exactResults.length : 0,
      prefix: Array.isArray(prefixResults) ? prefixResults.length : 0,
      fuzzy: Array.isArray(fuzzyResults) ? fuzzyResults.length : 0
    },
    notes
  };
}

async function benchmarkMiniSearch(documents: TestDocument[]): Promise<BenchmarkResult> {
  const notes: string[] = [];
  const memStart = getMemoryUsageMB();
  
  const MiniSearch = (await import('minisearch')).default;
  
  const miniSearch = new MiniSearch({
    fields: ['title', 'content', 'category', 'author'],
    storeFields: ['title', 'category', 'author'],
    searchOptions: {
      boost: { title: 2 },
      fuzzy: 0.2
    }
  });
  
  // Benchmark indexing
  const indexStart = performance.now();
  miniSearch.addAll(documents);
  const indexTime = performance.now() - indexStart;
  
  const memAfterIndex = getMemoryUsageMB();
  
  // Benchmark queries
  const queryStart1 = performance.now();
  const exactResults = miniSearch.search('artificial intelligence');
  const queryExact = performance.now() - queryStart1;
  
  const queryStart2 = performance.now();
  const prefixResults = miniSearch.search('artif', { prefix: true });
  const queryPrefix = performance.now() - queryStart2;
  
  const queryStart3 = performance.now();
  const fuzzyResults = miniSearch.search('inteligence', { fuzzy: 0.3 });
  const queryFuzzy = performance.now() - queryStart3;
  
  // Test serialization
  const persistStart = performance.now();
  const jsonData = JSON.stringify(miniSearch);
  const persistTime = performance.now() - persistStart;
  notes.push('JSON size: ' + Math.round(jsonData.length / 1024) + 'KB');
  
  const loadStart = performance.now();
  const loadedIndex = MiniSearch.loadJSON(jsonData, {
    fields: ['title', 'content', 'category', 'author'],
    storeFields: ['title', 'category', 'author']
  });
  const loadTime = performance.now() - loadStart;
  
  const memEnd = getMemoryUsageMB();
  
  return {
    name: 'MiniSearch',
    indexTime,
    queryExact,
    queryPrefix,
    queryFuzzy,
    memoryMB: memEnd - memStart,
    persistTime,
    loadTime,
    resultCount: {
      exact: exactResults.length,
      prefix: prefixResults.length,
      fuzzy: fuzzyResults.length
    },
    notes
  };
}

async function benchmarkLmdbIndex(documents: TestDocument[]): Promise<BenchmarkResult> {
  const notes: string[] = [];
  const memStart = getMemoryUsageMB();
  
  // Setup LMDB with lmdb-index
  const testDbPath = join(process.cwd(), 'data', 'search-benchmark');
  
  // Clean up existing test db
  if (existsSync(testDbPath)) {
    try {
      rmSync(testDbPath, { recursive: true });
    } catch {}
  }
  mkdirSync(testDbPath, { recursive: true });
  
  let queryExact = 0;
  let queryPrefix = 0;
  let queryFuzzy = 0;
  let resultCountExact = 0;
  let resultCountPrefix = 0;
  let resultCountFuzzy = 0;
  let indexTime = 0;
  
  try {
    const lmdb = await import('lmdb');
    const lmdbIndex = await import('lmdb-index');
    
    const open = lmdb.open;
    const withExtensions = lmdbIndex.withExtensions;
    const operators = lmdbIndex.operators;
    
    const rawDb = open(testDbPath, {
      indexOptions: { fulltext: true } as any
    });
    const db = withExtensions(rawDb);
    
    // Define schema
    db.defineSchema(Object);
    
    // Benchmark indexing
    const indexStart = performance.now();
    for (const doc of documents) {
      await db.put(null, {
        ...doc,
        '#': doc.id
      });
    }
    indexTime = performance.now() - indexStart;
    
    // Benchmark queries
    const queryStart1 = performance.now();
    const exactResults = [...(db as any).getRangeFromIndex({ 
      title: 'artificial intelligence' 
    }, null, null, { fulltext: true })];
    queryExact = performance.now() - queryStart1;
    resultCountExact = exactResults.length;
    
    // Prefix search with regex
    const queryStart2 = performance.now();
    const prefixResults = [...(db as any).getRangeFromIndex({ 
      title: /artif.*/ 
    }, null, null, { fulltext: true })];
    queryPrefix = performance.now() - queryStart2;
    resultCountPrefix = prefixResults.length;
    
    // Fuzzy search using operators
    const queryStart3 = performance.now();
    const fuzzyResults = [...(db as any).getRangeFromIndex({
      content: operators.$echoes('inteligence')
    }, null, null, { fulltext: true })];
    queryFuzzy = performance.now() - queryStart3;
    resultCountFuzzy = fuzzyResults.length;
    
    // Persistence is built-in for LMDB
    notes.push('Persistence is built-in (LMDB native storage)');
    
    // Close the database
    rawDb.close();
    
    const memEnd = getMemoryUsageMB();
    
    return {
      name: 'lmdb-index',
      indexTime,
      queryExact,
      queryPrefix,
      queryFuzzy,
      memoryMB: memEnd - memStart,
      persistTime: 0,
      loadTime: 0,
      resultCount: {
        exact: resultCountExact,
        prefix: resultCountPrefix,
        fuzzy: resultCountFuzzy
      },
      notes
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    notes.push('Error: ' + errorMessage);
    
    return {
      name: 'lmdb-index',
      indexTime,
      queryExact: 0,
      queryPrefix: 0,
      queryFuzzy: 0,
      memoryMB: getMemoryUsageMB() - memStart,
      resultCount: { exact: 0, prefix: 0, fuzzy: 0 },
      notes: [...notes, 'Benchmark failed - see errors above']
    };
  }
}

// Run benchmarks
async function main() {
  const docCounts = [1000, 5000, 10000];
  const allResults: Record<number, BenchmarkResult[]> = {};
  
  for (const count of docCounts) {
    allResults[count] = await runBenchmarks(count);
  }
  
  // Print summary
  const separator = '='.repeat(80);
  console.log('\n' + separator);
  console.log('BENCHMARK SUMMARY');
  console.log(separator);
  
  for (const [count, results] of Object.entries(allResults)) {
    console.log('\n--- ' + count + ' Documents---');
    console.log('\n| Solution | Index (ms) | Exact (ms) | Prefix (ms) | Fuzzy (ms) | Memory (MB) |');
    console.log('|----------|------------|------------|-------------|------------|-------------|');
    for (const r of results) {
      const name = r.name.padEnd(8);
      const idx = r.indexTime.toFixed(1).padStart(10);
      const exact = r.queryExact.toFixed(2).padStart(10);
      const prefix = r.queryPrefix.toFixed(2).padStart(11);
      const fuzzy = r.queryFuzzy.toFixed(2).padStart(10);
      const mem = r.memoryMB.toFixed(1).padStart(11);
      console.log('| ' + name + ' | ' + idx + ' | ' + exact + ' | ' + prefix + ' | ' + fuzzy + ' | ' + mem + ' |');
    }
    console.log('\nResult counts:');
    for (const r of results) {
      console.log('  ' + r.name + ': exact=' + r.resultCount.exact + ', prefix=' + r.resultCount.prefix + ', fuzzy=' + r.resultCount.fuzzy);
      if (r.notes.length > 0) {
        r.notes.forEach(n => console.log('    - ' + n));
      }
    }
  }
  
  // Write results to file
  const outputPath = join(process.cwd(), 'SEARCH_RESEARCH.md');
  return { allResults, outputPath };
}

main().then(({ allResults, outputPath }) => {
  console.log('\nBenchmark complete. Writing research document...');
  // The document will be written separately
}).catch(console.error);