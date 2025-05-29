#!/usr/bin/env python3

"""
Full Evaluation Runner for Tableau MCP Server
Runs ALL bird-mini test cases (all 114 test cases) against the Tableau MCP server
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path

from mcp_tableau_client import TableauMCPClient
from test_loader import BirdMiniTestLoader
from run_limited_evaluation import TableauMCPEvaluator


async def run_full_evaluation():
    """Run the complete evaluation with all test cases"""
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Check for OpenAI API key
    if not os.getenv("OPENAI_API_KEY"):
        logging.error("Please set OPENAI_API_KEY environment variable")
        return
    
    print("="*80)
    print("🚀 TABLEAU MCP FULL EVALUATION - ALL 114 TEST CASES")
    print("="*80)
    print("📊 Running evaluation on ALL three databases:")
    print("   • california_schools (30 test cases)")
    print("   • card_games (52 test cases)")
    print("   • financial (32 test cases)")
    print("📈 All difficulty levels: simple, moderate, challenging")
    print("🔓 NO LIMITATIONS - Full dataset evaluation")
    print("="*80)
    
    evaluator = TableauMCPEvaluator()
    
    # Show what we're about to run
    loader = BirdMiniTestLoader()
    all_cases = loader.load_test_cases(
        databases=["california_schools", "card_games", "financial"]  # All 3 databases
        # No difficulty_filter - include all difficulties
        # No limit - include all test cases
    )
    stats = loader.get_statistics(all_cases)
    
    print(f"\n📋 EVALUATION PLAN:")
    print(f"   Total test cases to run: {stats['total']}")
    print(f"   Databases: {list(stats['by_database'].keys())}")
    print(f"   Difficulty distribution: {stats['by_difficulty']}")
    print(f"   Estimated time: ~{stats['total'] * 1.5 / 60:.1f} minutes")
    
    # Confirm before running
    response = input(f"\n🤔 Ready to run {stats['total']} test cases? This will take some time. (y/N): ")
    if response.lower() != 'y':
        print("❌ Evaluation cancelled.")
        return
    
    print(f"\n🚀 Starting full evaluation...")
    start_time = datetime.now()
    
    # Run the FULL evaluation
    summary = await evaluator.run_evaluation(
        databases=["california_schools", "card_games", "financial"],  # ALL 3 databases
        difficulty_filter=None,  # ALL difficulty levels
        limit_per_db=None,       # NO limit per database
        save_intermediate=True   # Save after each test for safety
    )
    
    end_time = datetime.now()
    duration = end_time - start_time
    
    # Print comprehensive summary
    print("\n" + "="*80)
    print("🎉 FULL EVALUATION COMPLETE!")
    print("="*80)
    print(f"⏱️  Total Duration: {duration}")
    print(f"📊 Total Tests: {summary['total_tests']}")
    print(f"✅ Successful: {summary['successful']} ({summary['success_rate']*100:.1f}%)")
    print(f"❌ Failed: {summary['failed']}")
    print(f"🚫 Errors: {summary['errors']}")
    print(f"⏱️  Average Execution Time: {summary['average_execution_time']:.2f}s")
    
    print(f"\n📊 RESULTS BY DATABASE:")
    for db, stats in summary['by_database'].items():
        success_rate = (stats['success'] / stats['total'] * 100) if stats['total'] > 0 else 0
        print(f"   {db}:")
        print(f"     Total: {stats['total']} test cases")
        print(f"     Success: {stats['success']} ({success_rate:.1f}%)")
        print(f"     Failed: {stats['failed']}")
        print(f"     Errors: {stats['error']}")
    
    print(f"\n💾 Results saved to: evaluation/results/")
    print(f"📁 Latest results: evaluation/results/latest_results.json")
    print(f"📈 Latest summary: evaluation/results/latest_summary.json")
    
    # Show VDS query capture statistics
    vds_captured = sum(1 for r in evaluator.results if r.get('vds_query'))
    vds_rate = (vds_captured / summary['total_tests'] * 100) if summary['total_tests'] > 0 else 0
    
    print(f"\n🔍 VDS QUERY CAPTURE:")
    print(f"   Captured: {vds_captured}/{summary['total_tests']} ({vds_rate:.1f}%)")
    
    print("="*80)
    print("🎯 Evaluation complete! You now have the full dataset results.")
    print("="*80)
    
    return summary


async def run_progressive_evaluation():
    """Run a progressive evaluation: small subset first, then full"""
    
    print("="*80)
    print("🧪 PROGRESSIVE EVALUATION MODE")
    print("="*80)
    print("This will run a small test first, then the full evaluation")
    print("="*80)
    
    evaluator = TableauMCPEvaluator()
    
    # First: Small subset to test
    print("\n📋 PHASE 1: Small subset test (6 test cases)")
    small_summary = await evaluator.run_evaluation(
        databases=["california_schools", "card_games"],
        difficulty_filter=["simple"],
        limit_per_db=3,
        save_intermediate=True
    )
    
    print(f"✅ Phase 1 complete: {small_summary['successful']}/{small_summary['total_tests']} successful")
    
    if small_summary['success_rate'] < 0.5:  # Less than 50% success
        print("⚠️  Low success rate in small test. Consider checking setup before full evaluation.")
        response = input("Continue with full evaluation anyway? (y/N): ")
        if response.lower() != 'y':
            print("❌ Full evaluation cancelled.")
            return small_summary
    
    # Second: Full evaluation
    print("\n📋 PHASE 2: Full evaluation (114 test cases)")
    response = input("Ready to run full evaluation with all 114 test cases? (y/N): ")
    if response.lower() != 'y':
        print("❌ Full evaluation cancelled.")
        return small_summary
    
    # Reset results for full evaluation
    evaluator.results = []
    
    full_summary = await evaluator.run_evaluation(
        databases=["california_schools", "card_games", "financial"],
        difficulty_filter=None,
        limit_per_db=None,
        save_intermediate=True
    )
    
    print("\n🎉 PROGRESSIVE EVALUATION COMPLETE!")
    print(f"📊 Final Results: {full_summary['successful']}/{full_summary['total_tests']} successful ({full_summary['success_rate']*100:.1f}%)")
    
    return full_summary


async def main():
    """Main entry point with options"""
    
    print("🔧 TABLEAU MCP EVALUATION OPTIONS")
    print("="*40)
    print("1. Full evaluation (all 114 test cases)")
    print("2. Progressive evaluation (small test + full)")
    print("3. Current limited evaluation (6 test cases)")
    print("="*40)
    
    choice = input("Choose evaluation mode (1/2/3): ").strip()
    
    if choice == "1":
        await run_full_evaluation()
    elif choice == "2":
        await run_progressive_evaluation()
    elif choice == "3":
        # Import and run the original limited evaluation
        from run_limited_evaluation import main as original_main
        await original_main()
    else:
        print("❌ Invalid choice. Exiting.")


if __name__ == "__main__":
    asyncio.run(main()) 