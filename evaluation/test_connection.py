"""
Test script to verify Tableau MCP server connection
Run this before the full evaluation to ensure everything is set up correctly
"""

import asyncio
import os
import json
import logging
from pathlib import Path

from mcp_tableau_client import TableauMCPClient


async def test_mcp_connection():
    """Test basic MCP server connectivity"""
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    
    # Check for OpenAI API key
    if not os.getenv("OPENAI_API_KEY"):
        logger.error("OPENAI_API_KEY environment variable not set!")
        return False
        
    # Check if MCP server is built
    mcp_path = Path(__file__).parent.parent / "build" / "index.js"
    if not mcp_path.exists():
        logger.error(f"MCP server not built! Expected at: {mcp_path}")
        logger.error("Run 'npm run build' from the project root")
        return False
        
    logger.info("Starting MCP connection test...")
    
    try:
        client = TableauMCPClient()
        
        # Test 1: List datasources
        logger.info("Test 1: Listing available datasources...")
        datasources = await client.list_datasources()
        logger.info(f"Available datasources: {datasources}")
        
        # Test 2: Simple query
        logger.info("\nTest 2: Running a simple query...")
        result = await client.query_datasource(
            datasource_name="california_schools",
            natural_language_query="How many schools are there in total?"
        )
        
        if result.get("success"):
            logger.info("✅ Query executed successfully!")
            logger.info(f"Trace ID: {result.get('trace_id')}")
            logger.info(f"Data preview: {str(result.get('data'))[:200]}...")
        else:
            logger.error(f"❌ Query failed: {result.get('error')}")
            
        return result.get("success", False)
        
    except Exception as e:
        logger.error(f"❌ Connection test failed: {str(e)}")
        return False


async def main():
    """Run the connection test"""
    print("="*60)
    print("TABLEAU MCP SERVER CONNECTION TEST")
    print("="*60)
    
    success = await test_mcp_connection()
    
    print("\n" + "="*60)
    if success:
        print("✅ Connection test PASSED! Ready to run evaluation.")
        print("\nNext steps:")
        print("1. Run 'python evaluation/run_evaluation.py' for full evaluation")
        print("2. Check evaluation/results/ for output files")
    else:
        print("❌ Connection test FAILED!")
        print("\nTroubleshooting:")
        print("1. Ensure OPENAI_API_KEY is set")
        print("2. Run 'npm run build' from project root")
        print("3. Check .env file has correct Tableau credentials")
        print("4. Verify Tableau datasources are published and accessible")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main()) 