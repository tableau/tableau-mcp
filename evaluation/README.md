# Tableau MCP Server Evaluation Framework

This framework evaluates the Tableau MCP server using the bird-mini benchmark test cases. It uses the OpenAI Agent SDK to connect to the MCP server and execute natural language queries against Tableau published data sources.

## 📊 **Test Cases Available**

**TOTAL: 114 test cases across 3 databases**
- `california_schools`: 30 test cases  
- `card_games`: 52 test cases
- `financial`: 32 test cases

**By Difficulty:**
- `simple`: 24 test cases
- `moderate`: 72 test cases  
- `challenging`: 18 test cases

## 🚀 **Quick Start - Choose Your Evaluation**

### Option 1: Full Evaluation (Recommended)
**All 114 test cases** - Complete evaluation of the MCP server
```bash
cd evaluation
python run_full_evaluation.py
```

### Option 2: Limited Testing (6 test cases)
**Quick test** - For development and debugging  
```bash
cd evaluation
python run_limited_evaluation.py
```

### Option 3: Check Available Test Cases
```bash
cd evaluation  
python check_test_cases.py
```

## ⚙️ **Evaluation Modes Explained**

### 🔓 **Full Evaluation** (`run_full_evaluation.py`)
- **✅ All 3 databases**: california_schools, card_games, financial
- **✅ All difficulty levels**: simple, moderate, challenging  
- **✅ All 114 test cases**: Complete dataset
- **✅ VDS queries captured**: Every result includes the generated VDS query
- **⏱️ Time**: ~3 hours (114 tests × 1.5min average)

### 🔒 **Limited Evaluation** (`run_limited_evaluation.py`)  
- **⚠️ Only 2 databases**: california_schools, card_games (missing financial)
- **⚠️ Only simple queries**: 24 simple cases (missing 90 moderate/challenging)
- **⚠️ Only 3 per database**: Total of 6 test cases (missing 108 others)
- **⏱️ Time**: ~10 minutes (6 tests)

## 🎯 **What Each Evaluation Captures**

Every test result includes:
```json
{
  "test_case": {
    "question_id": 123,
    "db_id": "card_games", 
    "question": "How many different power levels are there?",
    "sql": "SELECT COUNT(DISTINCT Power) FROM cards",
    "difficulty": "simple"
  },
  "mcp_result": {
    "success": true,
    "data": "There are 30 different power levels...",
    "vds_query": {
      "fields": [{"fieldCaption": "Power", "function": "COUNTD"}]
    }
  },
  "vds_query": {
    "fields": [{"fieldCaption": "Power", "function": "COUNTD"}]
  },
  "execution_time": 2.3,
  "status": "success"
}
```

## 📁 **Results Location**

All results are saved to:
- `evaluation/results/latest_results.json` - Detailed test results
- `evaluation/results/latest_summary.json` - Summary statistics  
- `evaluation/results/tableau_mcp_results_YYYYMMDD_HHMMSS.json` - Timestamped results

## 🔧 **Prerequisites**

1. **Node.js and npm** - Required to run the Tableau MCP server
2. **Python 3.10+** - Required for the evaluation framework
3. **OpenAI API Key** - Required for the agent to construct VDS queries
4. **Tableau MCP Server** - Built and ready in `../build/index.js`

## 🏗️ **Setup** 

1. **Build MCP Server:**
```bash
cd .. # Go to project root
npm run build
```

2. **Set up Python environment:**
```bash
cd evaluation
python -m venv eval-venv
source eval-venv/bin/activate  # On Windows: eval-venv\Scripts\activate
pip install -r requirements.txt
```

3. **Set environment variables:**
```bash
export OPENAI_API_KEY="your-key-here"
```

4. **Test connection:**
```bash
python test_connection.py
```

## 📈 **Progressive Evaluation**

For safety, you can run a progressive evaluation:
1. **Small test first** (6 cases) - Verify everything works
2. **Full evaluation** (114 cases) - Complete analysis

```bash
python run_full_evaluation.py
# Choose option 2: Progressive evaluation
```

## 🔍 **Understanding Results**

- **Success Rate**: Percentage of queries that executed successfully
- **VDS Query Capture**: How many test cases captured the generated VDS query
- **Execution Time**: Average time per query (includes agent reasoning + Tableau execution)
- **By Database**: Performance breakdown per datasource
- **By Difficulty**: Performance across simple/moderate/challenging queries

## 🎯 **Next Steps**

After running the evaluation:
1. **Analyze VDS queries** - Compare generated queries to gold SQL
2. **Performance analysis** - Identify patterns in success/failure
3. **Quality evaluation** - Use LLM-as-a-judge to score response quality
4. **Iterative improvement** - Refine agent instructions based on results

## Project Structure

```
evaluation/
├── mcp_tableau_client.py       # MCP client using OpenAI Agent SDK
├── test_loader.py              # Loads bird-mini test cases
├── run_full_evaluation.py      # Full evaluation runner (all 114 test cases)
├── run_limited_evaluation.py   # Limited evaluation runner (6 test cases)
├── start_evaluation.py         # Interactive launcher
├── check_test_cases.py         # Test case analysis
├── requirements.txt            # Python dependencies
├── README.md                   # This file
└── results/                    # Evaluation results (created automatically)
```

## Usage

### Quick Start

Run a small evaluation with 5 simple test cases from california_schools:

```bash
python evaluation/run_evaluation.py
```

### Custom Evaluation

You can customize the evaluation by modifying the parameters in `run_evaluation.py`:

```python
# Run all databases with moderate difficulty
summary = await evaluator.run_evaluation(
    databases=["california_schools", "card_games", "financial"],
    difficulty_filter=["simple", "moderate"],
    limit_per_db=10,
    save_intermediate=True
)
```

### Programmatic Usage

```python
import asyncio
from evaluation.mcp_tableau_client import TableauMCPClient

async def test_single_query():
    client = TableauMCPClient()
    
    result = await client.query_datasource(
        datasource_name="california_schools",
        natural_language_query="What is the average SAT math score?"
    )
    
    print(result)

asyncio.run(test_single_query())
```

## How It Works

### 1. MCP Connection
The framework uses `MCPServerStdio` from the OpenAI Agent SDK to connect to the Tableau MCP server as a subprocess:

```python
async with MCPServerStdio(
    name="Tableau MCP Server",
    params={
        "command": "node",
        "args": ["/path/to/tableau-mcp/build/index.js"],
    },
) as mcp_server:
    # Use the server...
```

### 2. Agent Configuration
An OpenAI agent is configured with instructions to:
- List available datasources
- Inspect field metadata
- Construct VDS queries based on natural language
- Execute queries and return results

### 3. VDS Query Construction
The agent uses the MCP tools to:
1. `list-datasources` - Find the datasource LUID
2. `list-fields` - Get field names and descriptions
3. `query-datasource` - Execute the VDS query with proper field names and aggregations

### 4. Results Collection
Each test result includes:
- Original test case details (question, SQL, difficulty)
- MCP/VDS query results
- Execution time
- Success/failure status
- Error messages (if any)

## Output Files

The evaluation creates several output files in the `results/` directory:

1. **Detailed Results**: `tableau_mcp_results_YYYYMMDD_HHMMSS.json`
   - Complete results for each test case
   - Includes VDS responses and any errors

2. **Summary**: `tableau_mcp_summary_YYYYMMDD_HHMMSS.json`
   - Overall success rate
   - Breakdown by database
   - Average execution times

3. **Latest Results**: `latest_results.json` and `latest_summary.json`
   - Always contains the most recent evaluation results

## Interpreting Results

The evaluation summary includes:
- **Total Tests**: Number of test cases executed
- **Successful**: Tests that returned data successfully
- **Failed**: Tests where the MCP server returned an error
- **Errors**: Tests that couldn't be executed (e.g., connection issues)
- **Success Rate**: Percentage of successful tests
- **By Database**: Breakdown of results for each database

## Next Steps

After running the basic evaluation:

1. **Compare Results**: Implement comparison between VDS results and SQL gold standard results
2. **LLM-as-Judge**: Use an LLM to evaluate semantic correctness of results
3. **Performance Analysis**: Analyze query execution times and optimize
4. **Error Analysis**: Investigate failed queries and improve the agent's instructions
5. **Scale Up**: Run full evaluation on all test cases

## Troubleshooting

### Common Issues

1. **"OpenAI API key is required"**
   - Set the `OPENAI_API_KEY`