"""
Main Evaluation Runner for Tableau MCP Server
Runs the bird-mini test cases against the Tableau MCP server and evaluates results
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
import time

from mcp_tableau_client import TableauMCPClient
from test_loader import BirdMiniTestLoader, TestCase


class TableauMCPEvaluator:
    """Evaluates Tableau MCP server performance on bird-mini test cases"""
    
    def __init__(self, 
                 output_dir: str = None,
                 mcp_server_path: str = None,
                 openai_api_key: str = None):
        """
        Initialize the evaluator
        
        Args:
            output_dir: Directory to save evaluation results
            mcp_server_path: Path to the Tableau MCP server
            openai_api_key: OpenAI API key for the agent
        """
        self.output_dir = Path(output_dir) if output_dir else Path(__file__).parent / "results"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.logger = logging.getLogger(__name__)
        
        # Initialize components
        self.test_loader = BirdMiniTestLoader()
        self.mcp_client = TableauMCPClient(
            mcp_server_path=mcp_server_path,
            openai_api_key=openai_api_key
        )
        
        # Results storage
        self.results = []
        
    async def run_single_test(self, test_case: TestCase) -> Dict[str, Any]:
        """
        Run a single test case
        
        Args:
            test_case: The test case to run
            
        Returns:
            Dictionary with test results
        """
        self.logger.info(f"Running test {test_case.question_id}: {test_case.question[:50]}...")
        
        start_time = time.time()
        
        # Get the Tableau datasource name
        datasource_name = self.test_loader.get_tableau_datasource_name(test_case.db_id)
        
        # Run the query through MCP
        try:
            mcp_result = await self.mcp_client.query_datasource(
                datasource_name=datasource_name,
                natural_language_query=test_case.question
            )
            
            execution_time = time.time() - start_time
            
            # Ensure vds_query is captured in the result
            vds_query = mcp_result.get("vds_query")
            if not vds_query and mcp_result.get("data"):
                # If VDS_QUERY wasn't captured from response, try to extract it
                response_text = mcp_result.get("data", "")
                if "VDS_QUERY:" in response_text:
                    self.logger.info(f"Found VDS_QUERY in response for test {test_case.question_id}")
            
            result = {
                "test_case": test_case.to_dict(),
                "mcp_result": mcp_result,  # This now includes the vds_query field
                "execution_time": execution_time,
                "status": "success" if mcp_result.get("success") else "failed",
                "error": mcp_result.get("error"),
                "vds_query": vds_query,  # Explicitly include VDS query at top level
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            self.logger.error(f"Error running test {test_case.question_id}: {str(e)}")
            execution_time = time.time() - start_time
            
            result = {
                "test_case": test_case.to_dict(),
                "mcp_result": None,
                "execution_time": execution_time,
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
            
        return result
    
    async def run_evaluation(self,
                           databases: Optional[List[str]] = None,
                           difficulty_filter: Optional[List[str]] = None,
                           limit_per_db: Optional[int] = None,
                           save_intermediate: bool = True) -> Dict[str, Any]:
        """
        Run the full evaluation
        
        Args:
            databases: List of databases to test (defaults to all)
            difficulty_filter: List of difficulty levels to include
            limit_per_db: Maximum number of tests per database
            save_intermediate: Whether to save results after each test
            
        Returns:
            Dictionary with evaluation summary
        """
        self.logger.info("Starting Tableau MCP evaluation")
        
        # Load test cases
        test_cases = self.test_loader.load_test_cases(
            databases=databases,
            difficulty_filter=difficulty_filter,
            limit=limit_per_db
        )
        
        stats = self.test_loader.get_statistics(test_cases)
        self.logger.info(f"Loaded {stats['total']} test cases")
        
        # Run tests
        self.results = []
        
        for i, test_case in enumerate(test_cases):
            self.logger.info(f"Running test {i+1}/{len(test_cases)}")
            
            result = await self.run_single_test(test_case)
            self.results.append(result)
            
            # Save intermediate results
            if save_intermediate:
                self.save_results()
                
            # Add a small delay to avoid overwhelming the server
            await asyncio.sleep(1)
        
        # Generate summary
        summary = self.generate_summary()
        
        # Save final results
        self.save_results()
        self.save_summary(summary)
        
        return summary
    
    def generate_summary(self) -> Dict[str, Any]:
        """Generate evaluation summary statistics"""
        total_tests = len(self.results)
        successful_tests = sum(1 for r in self.results if r["status"] == "success")
        failed_tests = sum(1 for r in self.results if r["status"] == "failed")
        error_tests = sum(1 for r in self.results if r["status"] == "error")
        
        # Group by database
        by_database = {}
        for result in self.results:
            db = result["test_case"]["db_id"]
            if db not in by_database:
                by_database[db] = {"total": 0, "success": 0, "failed": 0, "error": 0}
            
            by_database[db]["total"] += 1
            by_database[db][result["status"]] += 1
        
        # Calculate average execution time
        execution_times = [r["execution_time"] for r in self.results if r["execution_time"]]
        avg_execution_time = sum(execution_times) / len(execution_times) if execution_times else 0
        
        summary = {
            "total_tests": total_tests,
            "successful": successful_tests,
            "failed": failed_tests,
            "errors": error_tests,
            "success_rate": successful_tests / total_tests if total_tests > 0 else 0,
            "by_database": by_database,
            "average_execution_time": avg_execution_time,
            "timestamp": datetime.now().isoformat()
        }
        
        return summary
    
    def save_results(self):
        """Save detailed results to file"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        results_file = self.output_dir / f"tableau_mcp_results_{timestamp}.json"
        
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2)
            
        self.logger.info(f"Saved results to {results_file}")
        
        # Also save the latest results
        latest_file = self.output_dir / "latest_results.json"
        with open(latest_file, 'w') as f:
            json.dump(self.results, f, indent=2)
    
    def save_summary(self, summary: Dict[str, Any]):
        """Save evaluation summary"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        summary_file = self.output_dir / f"tableau_mcp_summary_{timestamp}.json"
        
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
            
        self.logger.info(f"Saved summary to {summary_file}")
        
        # Also save the latest summary
        latest_file = self.output_dir / "latest_summary.json"
        with open(latest_file, 'w') as f:
            json.dump(summary, f, indent=2)


async def main():
    """Main entry point"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Check for OpenAI API key
    if not os.getenv("OPENAI_API_KEY"):
        logging.error("Please set OPENAI_API_KEY environment variable")
        return
    
    print("="*60)
    print("⚠️  TABLEAU MCP LIMITED EVALUATION (6 TEST CASES)")
    print("="*60)
    print("🔒 This is a LIMITED evaluation for testing purposes")
    print("📊 Running only 6 out of 114 available test cases:")
    print("   • Only 2/3 databases (missing financial)")
    print("   • Only simple difficulty (missing moderate/challenging)")
    print("   • Only 3 test cases per database")
    print("")
    print("🚀 For FULL evaluation of all 114 test cases, run:")
    print("   python run_full_evaluation.py")
    print("="*60)
    
    response = input("\nContinue with limited evaluation (6 test cases)? (y/N): ")
    if response.lower() != 'y':
        print("❌ Evaluation cancelled.")
        print("💡 Run 'python run_full_evaluation.py' for the complete evaluation")
        return
    
    evaluator = TableauMCPEvaluator()
    
    # Run evaluation with a small subset first
    summary = await evaluator.run_evaluation(
        databases=["california_schools", "card_games"],  # ⚠️ Only 2/3 databases
        difficulty_filter=["simple"],                   # ⚠️ Only simple queries
        limit_per_db=3,                                 # ⚠️ Only 3 per database
        save_intermediate=True
    )
    
    # Print summary
    print("\n" + "="*60)
    print("📊 LIMITED EVALUATION SUMMARY")
    print("="*60)
    print(f"Total Tests: {summary['total_tests']} (out of 114 available)")
    print(f"Successful: {summary['successful']} ({summary['success_rate']*100:.1f}%)")
    print(f"Failed: {summary['failed']}")
    print(f"Errors: {summary['errors']}")
    print(f"Average Execution Time: {summary['average_execution_time']:.2f}s")
    
    print("\nBy Database:")
    for db, stats in summary['by_database'].items():
        success_rate = (stats['success'] / stats['total'] * 100) if stats['total'] > 0 else 0
        print(f"  {db}: {stats['success']}/{stats['total']} ({success_rate:.1f}% success)")
    
    print(f"\nResults saved to: evaluation/results/")
    print("="*60)
    print("⚠️  This was a LIMITED evaluation (6/114 test cases)")
    print("🚀 For complete evaluation, run: python run_full_evaluation.py")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main()) 